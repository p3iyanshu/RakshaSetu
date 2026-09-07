"""
PointNet++-style segmentation network (pure PyTorch, see pointnet_utils.py
for why there's no compiled CUDA extension) plus the `classify()` entry
point that satisfies the exact interface contract from
team_tasks/01_data_and_segmentation_model.md:

    classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]

Architecture: 4 Set Abstraction levels (progressively downsample + build
features) followed by 4 Feature Propagation levels (upsample back to every
input point, decoder-style with skip connections) -- the standard PointNet++
segmentation shape. Works on any input point count N (not just the fixed
size used during training) since every layer samples relative to whatever N
it's given.
"""
import os
import sys

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from pointnet_utils import SetAbstraction, FeaturePropagation
from class_mapping import NUM_CLASSES

DEFAULT_CHECKPOINT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints", "best.pth")


class PointNet2Seg(nn.Module):
    def __init__(self, num_classes=NUM_CLASSES, in_feat_channels=1):
        super().__init__()
        self.sa1 = SetAbstraction(n_sample=2048, k=32, in_channels=in_feat_channels, mlp_channels=[32, 32, 64])
        self.sa2 = SetAbstraction(n_sample=512, k=32, in_channels=64, mlp_channels=[64, 64, 128])
        self.sa3 = SetAbstraction(n_sample=128, k=32, in_channels=128, mlp_channels=[128, 128, 256])
        self.sa4 = SetAbstraction(n_sample=32, k=16, in_channels=256, mlp_channels=[256, 256, 512])

        self.fp4 = FeaturePropagation(in_channels=512 + 256, mlp_channels=[256, 256])
        self.fp3 = FeaturePropagation(in_channels=256 + 128, mlp_channels=[256, 128])
        self.fp2 = FeaturePropagation(in_channels=128 + 64, mlp_channels=[128, 128])
        self.fp1 = FeaturePropagation(in_channels=128 + in_feat_channels, mlp_channels=[128, 128, 128])

        self.head = nn.Sequential(
            nn.Conv1d(128, 128, 1), nn.BatchNorm1d(128), nn.ReLU(inplace=True), nn.Dropout(0.3),
            nn.Conv1d(128, num_classes, 1),
        )

    def forward(self, points):
        """points: (B, N, 4) x,y,z,intensity -> logits (B, N, num_classes)"""
        xyz0 = points[..., :3].contiguous()
        feat0 = points[..., 3:].contiguous()  # intensity

        xyz1, feat1 = self.sa1(xyz0, feat0)
        xyz2, feat2 = self.sa2(xyz1, feat1)
        xyz3, feat3 = self.sa3(xyz2, feat2)
        xyz4, feat4 = self.sa4(xyz3, feat3)

        feat3 = self.fp4(xyz3, xyz4, feat3, feat4)
        feat2 = self.fp3(xyz2, xyz3, feat2, feat3)
        feat1 = self.fp2(xyz1, xyz2, feat1, feat2)
        feat0 = self.fp1(xyz0, xyz1, feat0, feat1)

        logits = self.head(feat0.permute(0, 2, 1)).permute(0, 2, 1)
        return logits


# ---------------------------------------------------------------------------
# Inference entry point -- the exact signature Member 4 wraps as a ROS 2 node
# ---------------------------------------------------------------------------
_MODEL = None
_DEVICE = None
_CKPT_PATH = None


def _load_model(checkpoint_path, device):
    global _MODEL, _DEVICE, _CKPT_PATH
    if _MODEL is None or _CKPT_PATH != checkpoint_path:
        _DEVICE = device or ("cuda" if torch.cuda.is_available() else "cpu")
        model = PointNet2Seg().to(_DEVICE)
        state = torch.load(checkpoint_path, map_location=_DEVICE)
        model.load_state_dict(state.get("model_state_dict", state))
        model.eval()
        _MODEL = model
        _CKPT_PATH = checkpoint_path
    return _MODEL, _DEVICE


def classify(points: np.ndarray, checkpoint_path: str = DEFAULT_CHECKPOINT, device: str = None):
    """
    points: (N, 4) array of x, y, z, intensity
    returns: labels (N,) uint8 in {0,1,2}, confidence (N,) float32 in [0,1]
    """
    model, dev = _load_model(checkpoint_path, device)
    with torch.no_grad():
        pts = torch.from_numpy(np.asarray(points, dtype=np.float32)).unsqueeze(0).to(dev)
        logits = model(pts)
        probs = F.softmax(logits, dim=-1)
        conf, labels = probs.max(dim=-1)
        return labels.squeeze(0).cpu().numpy().astype(np.uint8), conf.squeeze(0).cpu().numpy().astype(np.float32)


if __name__ == "__main__":
    model = PointNet2Seg()
    n_params = sum(p.numel() for p in model.parameters())
    print(f"PointNet2Seg: {n_params:,} parameters")

    dummy = torch.randn(2, 8192, 4)
    out = model(dummy)
    print("forward pass output shape:", out.shape)  # expect (2, 8192, 3)
