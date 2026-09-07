"""
Building blocks for the PointNet++-style segmentation network, implemented
in plain PyTorch (no compiled CUDA extension like pointnet2_ops/spconv/
MinkowskiEngine -- those need a matching nvcc+MSVC toolchain to build and
are a common source of pain on Windows; this trades a bit of raw speed for
"just works" on any machine with a CUDA-enabled torch install).

Downsampling uses random sampling rather than iterative farthest-point
sampling: FPS is the textbook PointNet++ choice but is O(M*N) per layer and
noticeably slower for no real accuracy win at these point counts; RandLA-Net
(Hu et al. 2020) showed random sampling works about as well in practice
while being O(1). Grouping uses exact kNN via torch.cdist, which is fine at
this scale (largest distance matrix here is a few tens of MB per batch item).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


def index_points(points, idx):
    """points: (B, N, C); idx: (B, S) or (B, S, K) -> gathered (B, S, C) or (B, S, K, C)"""
    B = points.shape[0]
    view_shape = [B] + [1] * (idx.dim() - 1)
    repeat_shape = [1] + list(idx.shape[1:])
    batch_idx = torch.arange(B, device=points.device).view(view_shape).repeat(repeat_shape)
    return points[batch_idx, idx, :]


def random_sample(xyz, n_sample):
    """xyz: (B, N, 3) -> idx: (B, n_sample), sampled without replacement per batch item."""
    B, N, _ = xyz.shape
    idx = torch.stack([torch.randperm(N, device=xyz.device)[:n_sample] for _ in range(B)], dim=0)
    return idx


def knn_group(query_xyz, xyz, k):
    """query_xyz: (B, S, 3) centers; xyz: (B, N, 3) full set -> idx: (B, S, K) indices into xyz
    of the k nearest neighbors of each center."""
    dists = torch.cdist(query_xyz, xyz)  # (B, S, N)
    idx = dists.topk(k, dim=-1, largest=False).indices
    return idx


class SetAbstraction(nn.Module):
    """Downsample N points -> n_sample points; for each sampled center, gather its
    k nearest neighbors, run a shared MLP over (relative_xyz, features), then
    max-pool over the neighborhood -> one feature vector per sampled center."""

    def __init__(self, n_sample, k, in_channels, mlp_channels):
        super().__init__()
        self.n_sample = n_sample
        self.k = k
        layers = []
        last = in_channels + 3  # +3 for relative xyz concatenated into every group
        for out_c in mlp_channels:
            layers += [nn.Conv2d(last, out_c, 1), nn.BatchNorm2d(out_c), nn.ReLU(inplace=True)]
            last = out_c
        self.mlp = nn.Sequential(*layers)
        self.out_channels = last

    def forward(self, xyz, features):
        """xyz: (B, N, 3); features: (B, N, C) or None -> new_xyz (B, S, 3), new_features (B, S, out_channels)"""
        B, N, _ = xyz.shape
        sample_idx = random_sample(xyz, min(self.n_sample, N))
        new_xyz = index_points(xyz, sample_idx)  # (B, S, 3)

        knn_idx = knn_group(new_xyz, xyz, min(self.k, N))  # (B, S, K)
        grouped_xyz = index_points(xyz, knn_idx)  # (B, S, K, 3)
        grouped_xyz_rel = grouped_xyz - new_xyz.unsqueeze(2)  # relative position within the neighborhood

        if features is not None:
            grouped_features = index_points(features, knn_idx)  # (B, S, K, C)
            grouped = torch.cat([grouped_xyz_rel, grouped_features], dim=-1)
        else:
            grouped = grouped_xyz_rel

        grouped = grouped.permute(0, 3, 2, 1)  # (B, C+3, K, S) for Conv2d
        out = self.mlp(grouped)  # (B, out_channels, K, S)
        new_features = out.max(dim=2).values.permute(0, 2, 1)  # (B, S, out_channels)
        return new_xyz, new_features


class FeaturePropagation(nn.Module):
    """Upsample features from a sparser point set back onto a denser one via
    inverse-distance-weighted interpolation from the 3 nearest sparse points,
    concatenated with that denser level's own skip-connection features, then
    a shared MLP."""

    def __init__(self, in_channels, mlp_channels):
        super().__init__()
        layers = []
        last = in_channels
        for out_c in mlp_channels:
            layers += [nn.Conv1d(last, out_c, 1), nn.BatchNorm1d(out_c), nn.ReLU(inplace=True)]
            last = out_c
        self.mlp = nn.Sequential(*layers)
        self.out_channels = last

    def forward(self, dense_xyz, sparse_xyz, dense_skip_features, sparse_features):
        """dense_xyz: (B, N, 3), sparse_xyz: (B, S, 3), dense_skip_features: (B, N, C1) or None,
        sparse_features: (B, S, C2) -> (B, N, out_channels)"""
        B, N, _ = dense_xyz.shape
        S = sparse_xyz.shape[1]

        if S == 1:
            interpolated = sparse_features.expand(B, N, sparse_features.shape[-1])
        else:
            dists = torch.cdist(dense_xyz, sparse_xyz)  # (B, N, S)
            k = min(3, S)
            nn_dists, nn_idx = dists.topk(k, dim=-1, largest=False)
            weights = 1.0 / (nn_dists + 1e-8)
            weights = weights / weights.sum(dim=-1, keepdim=True)
            neighbor_feats = index_points(sparse_features, nn_idx)  # (B, N, k, C2)
            interpolated = (neighbor_feats * weights.unsqueeze(-1)).sum(dim=2)

        if dense_skip_features is not None:
            combined = torch.cat([interpolated, dense_skip_features], dim=-1)
        else:
            combined = interpolated

        combined = combined.permute(0, 2, 1)  # (B, C, N) for Conv1d
        out = self.mlp(combined)
        return out.permute(0, 2, 1)  # (B, N, out_channels)
