"""
Day-1 placeholder classifier -- ships immediately so Members 2, 3 & 4 have a
real `classify()` to build against while the trained model (pointnet2.py)
is still training. Same exact signature the trained model will expose, so
swapping one for the other later is a one-line change for downstream code.

Crude ground-height threshold: the lowest band of points in a scan is
drivable, everything else is treated as a generic static obstacle. The
threshold is set per-scan from the scan's own height percentile rather than
a fixed absolute z, so it works whether z=0 means "at the sensor" (real
KITTI, ground around -1.7m) or "at road level" (the shared mock data, ground
around 0m) -- without that, a single hardcoded cutoff is correct for one
convention and silently wrong for the other. Cannot distinguish wall vs.
pole, vehicle vs. pedestrian, or any dynamic object at all (no learned class
boundary yet) -- everything non-ground is labeled STATIC_OBSTACLE_WALL as
the least-commitment guess, and confidence is deliberately capped low here
so any consumer doing confidence-based filtering treats this appropriately
as a stand-in, not a real prediction.
"""
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from class_mapping import DRIVABLE, STATIC_OBSTACLE_WALL

GROUND_PERCENTILE = 15  # bottom 15% of points by height anchors the ground band
GROUND_BAND_M = 0.3      # points within this margin above that anchor still count as ground
PLACEHOLDER_CONFIDENCE = 0.3  # low on purpose -- signals "not a real model" to consumers


def classify(points: np.ndarray):
    """
    points: (N, 4) array of x, y, z, intensity
    returns: labels (N,) in {DRIVABLE, STATIC_OBSTACLE_WALL}, confidence (N,) filled with a flat low value
    """
    z = points[:, 2]
    ground_z = np.percentile(z, GROUND_PERCENTILE)
    labels = np.where(z <= ground_z + GROUND_BAND_M, DRIVABLE, STATIC_OBSTACLE_WALL).astype(np.uint8)
    confidence = np.full(len(points), PLACEHOLDER_CONFIDENCE, dtype=np.float32)
    return labels, confidence


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
    from mock_data import load_npz

    pts, gt_labels, _ = load_npz(os.path.join(os.path.dirname(__file__), "..", "shared", "sample_data", "npz_frames", "frame_0000.npz"))
    labels, conf = classify(pts)
    print(f"classified {len(pts)} points -> labels shape {labels.shape}, confidence shape {conf.shape}")
    print("predicted class counts:", dict(zip(*np.unique(labels, return_counts=True))))
    print("ground-truth class counts:", dict(zip(*np.unique(gt_labels, return_counts=True))))
