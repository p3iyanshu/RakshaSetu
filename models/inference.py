"""
inference.py -- the exact classify() entry point from
team_tasks/01_data_and_segmentation_model.md's interface contract:

    classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]

Wraps the approved Step 1-5 pipeline (label_remap.py is NOT used here --
there's no ground truth at inference; cleaning.py + feature_engineering.py
ARE reused unchanged) around the trained PointNet2SegMSG checkpoint, and
applies the exact per-channel feature normalization computed and saved
during training (train.py's dataset_stats.json / checkpoint) -- never
recomputed here, since train/val/inference must use identical stats.

IMPORTANT -- flagged per interfaces.md section 4's own instruction ("If your
model drops/filters points internally, tell me -- we'll add an `indices`
field rather than assume"): cleaning.py can drop points (NaN/Inf, or outside
the sensor's 0.9-120m valid range). To keep `labels`/`confidence` the same
length N and same order as the input `points` (the contract's hard
requirement) WITHOUT adding a new `indices` field, dropped points are kept
in the output at their original position, labeled OTHER_UNKNOWN with
confidence 0.0 -- a sentinel meaning "not a real prediction, this point was
filtered as sensor noise/corruption", not a genuine classification. Real-data
validation (cleaning.py's docstring) found this essentially never triggers
on real KITTI data, but the contract must hold even in the rare case it does.
This choice should be confirmed with Member 4 rather than assumed final.

CRITICAL -- density mismatch (found 2026-09-14 while regenerating the
dashboard demo feed, before this fix was in place): the model is trained on
frames reduced to a fixed 8192 points (dataset.py's class-aware sampling),
but a real raw scan has ~100k-125k points. Even with ball query (a fixed
PHYSICAL radius, not k-nearest-neighbors) making each neighborhood's *extent*
density-independent, PointNet2SegMSG's Set Abstraction layers still sample a
FIXED NUMBER of centers per layer (1024/256/64), not a fixed fraction -- so
at full raw density, those same 1024 first-layer centers end up representing
a much SPARSER slice of the scene, and each center's ball query captures far
MORE points within its fixed radius than the network ever saw during
training. Measured on a real training-set frame: feeding the full ~115k
points directly scored mIoU 0.32 with static_obstacle_pole wildly
over-predicted (47% of all points, vs. 2.4% actual) -- subsampling that same
frame to 8192 points (matching training density) before inference recovered
mIoU to 0.62 on the same frame, with pole collapsing back to a realistic
0.4%. So classify() downsamples to MAX_INFERENCE_POINTS before the forward
pass and assigns every original point its nearest downsampled point's
prediction (scipy cKDTree) -- the same fix already applied to this project's
first (now-retired) segmentation architecture, never carried over when this
one replaced it.
"""
import os
import sys

import numpy as np
import torch
import torch.nn.functional as F
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from cleaning import clean_point_cloud
from feature_engineering import compute_features, FEATURE_NAMES
from label_remap import RAKSHASETU_CLASS_NAMES, IGNORE_LABEL
from pointnet2_seg import PointNet2SegMSG, NUM_CLASSES

OTHER_UNKNOWN = 5  # sentinel label for points cleaning dropped -- see module docstring
DEFAULT_CHECKPOINT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints", "best.pth")
MAX_INFERENCE_POINTS = 8192  # must match train.py's --num-points (the density the model was trained at)

_MODEL = None
_DEVICE = None
_CKPT_PATH = None
_FEAT_MEAN = None
_FEAT_STD = None


def _load_model(checkpoint_path, device):
    global _MODEL, _DEVICE, _CKPT_PATH, _FEAT_MEAN, _FEAT_STD
    if _MODEL is None or _CKPT_PATH != checkpoint_path:
        _DEVICE = device or ("cuda" if torch.cuda.is_available() else "cpu")
        ckpt = torch.load(checkpoint_path, map_location=_DEVICE)
        model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=len(FEATURE_NAMES)).to(_DEVICE)
        model.load_state_dict(ckpt["model_state_dict"])
        model.eval()

        stats = ckpt["dataset_stats"]
        _FEAT_MEAN = torch.tensor(stats["feature_mean"], dtype=torch.float32, device=_DEVICE)
        _FEAT_STD = torch.tensor(stats["feature_std"], dtype=torch.float32, device=_DEVICE)

        _MODEL = model
        _CKPT_PATH = checkpoint_path
    return _MODEL, _DEVICE, _FEAT_MEAN, _FEAT_STD


def classify(points: np.ndarray, checkpoint_path: str = DEFAULT_CHECKPOINT, device: str = None):
    """
    points: (N, 4) array of x, y, z, intensity
    returns: labels (N,) int in {0..5}, confidence (N,) float32 in [0,1]
             (never IGNORE_LABEL -- that's training-only, per the contract)
    """
    model, dev, feat_mean, feat_std = _load_model(checkpoint_path, device)
    points = np.asarray(points, dtype=np.float32)
    n = len(points)

    dummy_labels = np.full(n, IGNORE_LABEL, dtype=np.int64)  # cleaning.py needs a parallel array; unused otherwise
    clean_points, _, report = clean_point_cloud(points, dummy_labels)

    # Recover which original points survived cleaning, to place predictions
    # back at their original index (see module docstring on order preservation).
    finite = np.isfinite(points).all(axis=1)
    safe_xyz = np.where(finite[:, None], points[:, :3], 0.0)
    r = np.linalg.norm(safe_xyz, axis=1)
    keep_mask = finite & (r >= 0.9) & (r <= 120.0)

    labels = np.full(n, OTHER_UNKNOWN, dtype=np.int64)
    confidence = np.zeros(n, dtype=np.float32)

    if len(clean_points) > 0:
        feats_dict, _ = compute_features(clean_points)
        feats = np.stack([feats_dict[name] for name in FEATURE_NAMES], axis=1).astype(np.float32)

        m = len(clean_points)
        if m > MAX_INFERENCE_POINTS:
            infer_idx = np.random.default_rng().choice(m, MAX_INFERENCE_POINTS, replace=False)
        else:
            infer_idx = np.arange(m)
        infer_xyz = clean_points[infer_idx, :3]
        infer_feats = feats[infer_idx]

        with torch.no_grad():
            xyz_t = torch.from_numpy(infer_xyz).unsqueeze(0).to(dev)
            feat_t = torch.from_numpy(infer_feats).unsqueeze(0).to(dev)
            feat_t = (feat_t - feat_mean) / feat_std
            logits = model(xyz_t, feat_t)
            probs = F.softmax(logits, dim=-1)
            conf, pred = probs.max(dim=-1)
        pred = pred.squeeze(0).cpu().numpy()
        conf = conf.squeeze(0).cpu().numpy()

        if m > MAX_INFERENCE_POINTS:
            # every cleaned point inherits its nearest downsampled point's prediction.
            # workers=-1 parallelizes the query across all CPU cores -- k=1 NN search is
            # exact/deterministic regardless of thread count, so results are unaffected
            # (measured ~4.7x speedup on real KITTI frames, ~100ms -> ~21ms; leafsize/
            # balanced_tree/compact_nodes tuning tested and gave no reliable further gain
            # at this tree size, so left at scipy's defaults).
            nn_idx = cKDTree(infer_xyz).query(clean_points[:, :3], k=1, workers=-1)[1]
            pred, conf = pred[nn_idx], conf[nn_idx]

        labels[keep_mask] = pred
        confidence[keep_mask] = conf

    return labels.astype(np.uint8), confidence


if __name__ == "__main__":
    import time

    data_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "semantickitti", "dataset")
    velo_path = os.path.join(data_root, "sequences", "08", "velodyne", "000000.bin")
    points = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)
    print(f"loaded real frame: {len(points)} raw points")

    t0 = time.time()
    labels, conf = classify(points)
    dt = time.time() - t0
    print(f"classify() took {dt*1000:.0f}ms for {len(points)} points")
    print("label counts:", dict(zip(*np.unique(labels, return_counts=True))))
    print("confidence range:", conf.min(), conf.max())
