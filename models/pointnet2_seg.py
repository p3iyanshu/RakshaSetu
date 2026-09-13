import torch
import torch.nn as nn

from pointnet2_utils import (
    PointNetSetAbstractionMSG,
    PointNetSetAbstraction,
    PointNetFeaturePropagation,
)

NUM_CLASSES = 6
IGNORE_LABEL = -1


def compute_class_weights(labels, num_classes=NUM_CLASSES, ignore_index=IGNORE_LABEL):
    labels = torch.as_tensor(labels)
    valid = labels != ignore_index
    counts = torch.bincount(
        labels[valid].to(torch.long), minlength=num_classes
    ).float()

    if torch.any(counts <= 0):
        missing = torch.nonzero(counts <= 0, as_tuple=False).flatten().tolist()
        raise ValueError(
            f"Cannot compute class weights: missing classes {missing}. "
            "Use the full real training split."
        )

    return counts.sum() / (num_classes * counts)


def build_loss(class_weights=None):
    if class_weights is None:
        return nn.CrossEntropyLoss(ignore_index=IGNORE_LABEL)

    return nn.CrossEntropyLoss(
        weight=torch.as_tensor(class_weights, dtype=torch.float32),
        ignore_index=IGNORE_LABEL,
    )


class PointNet2SegMSG(nn.Module):
    """Approved PointNet++ MSG/SSG segmentation variant.

    xyz:      [B, N, 3] raw ego-frame coordinates
    features: [B, N, 7] engineered features
    logits:   [B, N, 6]
    """

    def __init__(self, num_classes=NUM_CLASSES, feature_dim=7, in_channels=None):
        super().__init__()

        # Compatibility with the existing benchmark interface.
        if in_channels is not None:
            feature_dim = in_channels

        if feature_dim != 7:
            raise ValueError("This approved model expects exactly 7 engineered features.")

        # SA1: MSG, 8192 -> 1024
        self.sa1 = PointNetSetAbstractionMSG(
            1024,
            [0.5, 1.0, 2.0],
            [16, 32, 64],
            feature_dim,
            [[16, 16, 32], [32, 32, 64], [32, 48, 64]],
        )

        # SA2: MSG, 1024 -> 256
        self.sa2 = PointNetSetAbstractionMSG(
            256,
            [1.0, 2.0, 4.0],
            [16, 32, 64],
            self.sa1.out_channels,
            [[64, 64, 128], [64, 96, 128], [64, 96, 128]],
        )

        # SA3: SSG, 256 -> 64
        self.sa3 = PointNetSetAbstraction(
            64, 4.0, 32, self.sa2.out_channels, [128, 128, 256]
        )

        # SA4: global, 64 -> 1
        self.sa4 = PointNetSetAbstraction(
            1, None, None, self.sa3.out_channels, [256, 256, 512],
            group_all=True
        )

        # Feature propagation
        self.fp4 = PointNetFeaturePropagation(512 + 256, [256, 256])
        self.fp3 = PointNetFeaturePropagation(256 + 384, [256, 128])
        self.fp2 = PointNetFeaturePropagation(128 + 160, [128, 128])
        self.fp1 = PointNetFeaturePropagation(128 + feature_dim, [128, 128])

        self.head = nn.Sequential(
            nn.Conv1d(128, 128, 1, bias=False),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.5),
            nn.Conv1d(128, num_classes, 1),
        )

    def forward(self, xyz, features):
        if xyz.ndim != 3 or xyz.shape[-1] != 3:
            raise ValueError(f"xyz must have shape [B,N,3], got {tuple(xyz.shape)}")
        if features.ndim != 3 or features.shape[-1] != 7:
            raise ValueError(
                f"features must have shape [B,N,7], got {tuple(features.shape)}"
            )
        if xyz.shape[:2] != features.shape[:2]:
            raise ValueError("xyz and features must have the same B,N dimensions.")

        # Raw XYZ drives geometric sampling/grouping.
        # The 7 engineered features are the point-wise feature stream.
        l0_xyz, l0_points = xyz, features

        l1_xyz, l1_points = self.sa1(l0_xyz, l0_points)
        l2_xyz, l2_points = self.sa2(l1_xyz, l1_points)
        l3_xyz, l3_points = self.sa3(l2_xyz, l2_points)
        l4_xyz, l4_points = self.sa4(l3_xyz, l3_points)

        l3_up = self.fp4(l3_xyz, l4_xyz, l3_points, l4_points)
        l2_up = self.fp3(l2_xyz, l3_xyz, l2_points, l3_up)
        l1_up = self.fp2(l1_xyz, l2_xyz, l1_points, l2_up)
        l0_up = self.fp1(l0_xyz, l1_xyz, l0_points, l1_up)

        logits = self.head(l0_up.permute(0, 2, 1).contiguous())
        return logits.permute(0, 2, 1).contiguous()
