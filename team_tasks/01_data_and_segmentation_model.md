# Member 1 — Data Pipeline & Segmentation Model Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** turns raw LiDAR points into per-point class labels. This is the foundation everyone else's module builds on top of.

---

## Your mission

Build the data pipeline (SemanticKITTI, nuScenes, CARLA) and train the deep learning model that answers, for every single LiDAR point: *is this drivable terrain, a static obstacle, or a dynamic object?*

## Why this matters first

Members 2 and 3 (grid engine, tracking) both consume your output. You are the first link in the chain — so your top priority in week 1 is not the final trained model, it's shipping a **placeholder** fast so nobody downstream is blocked.

---

## Setup — get your environment ready before touching any task below

Do this once, on day 1, before step 1. If any of this fails, fix it now — don't discover a broken environment on the day you need to train.

```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS/Linux:            source .venv/bin/activate

pip install torch torchvision          # add --index-url per pytorch.org if you need a specific CUDA build
pip install numpy pandas scipy scikit-learn open3d tqdm pytest
```

Verify before moving on:
```bash
python -c "import torch; print('CUDA available:', torch.cuda.is_available())"
python -c "import open3d; print(open3d.__version__)"
```
If `torch.cuda.is_available()` is `False` and you have an NVIDIA GPU, fix the CUDA/driver mismatch now — training PointNet++ on CPU only is viable for smoke-testing but too slow for real iteration.

**Account setup (do this today — approval emails can take hours):**
- Register at [semantic-kitti.org](http://www.semantic-kitti.org/) and [nuscenes.org](https://www.nuscenes.org/) (start the **Mini** split download, not full trainval).
- Install CARLA: pin one release version (e.g. `0.9.15`) and `pip install carla==<same version>` — a version mismatch between the CARLA server and the Python client is a common silent-failure source.

**Definition of "ready to start":** venv created, both libraries import cleanly, dataset registration emails sent, CARLA installed and its example script runs.

---

## Task breakdown

### 1. Get the datasets
- **SemanticKITTI**: download the Velodyne point clouds + label data. Expected structure:
  ```
  semantickitti/dataset/sequences/00/velodyne/*.bin
  semantickitti/dataset/sequences/00/labels/*.label
  ```
- **nuScenes-lidarseg**: start with the **Mini** split (small, free, has lidarseg labels included) — don't pull the full trainval set unless you need more data later.
- **CARLA**: set up a `sensor.lidar.ray_cast_semantic` blueprint on a vehicle — this gives you `(x, y, z, cos_angle, object_idx, semantic_tag)` per point with zero manual labeling.

### 2. Build the class-remapping layer
All three sources use different raw class taxonomies (19–34 classes). Collapse them all into the 6 target classes locked in `ros2_ws/interfaces.md` v2: `0 = drivable`, `1 = static_obstacle_wall`, `2 = static_obstacle_pole`, `3 = dynamic_vehicle`, `4 = dynamic_pedestrian`, `5 = other_unknown`, `255 = ignore` (training-only — `classify()` never emits this at inference).

```python
# class_mapping.py
SEMANTICKITTI_MAP = {
    40: 0, 44: 0, 48: 0,                        # road, parking, sidewalk -> drivable
    50: 1, 51: 1,                                # building, fence -> static_obstacle_wall
    80: 2, 81: 2,                                 # pole, traffic-sign -> static_obstacle_pole
    10: 3, 13: 3, 18: 3,                           # car, bus, truck -> dynamic_vehicle
    30: 4, 31: 4,                                   # person, bicyclist -> dynamic_pedestrian
    99: 5,                                           # other-object -> other_unknown
    0: 255, 1: 255,                                   # unlabeled, outlier -> ignore
}

def remap_labels(raw_labels, mapping):
    lut = np.full(max(mapping.keys()) + 1, 255, dtype=np.uint8)
    for k, v in mapping.items():
        lut[k] = v
    return lut[raw_labels]
```
This is illustrative — the real, complete table (every raw id from all three sources, including the several genuinely ambiguous calls like "is a bicyclist a vehicle or a pedestrian?") is already built and committed at [`data/class_mapping.py`](../data/class_mapping.py); read it before starting, and check the inline `# REVIEW:` comments — those are first-pass judgment calls worth confirming with the team, not settled decisions. Do the same mapping table for nuScenes' and CARLA's tag sets — same idea, different source IDs.

### 3. Clean the data and engineer features — before you build the dataloader

Don't feed raw, unfiltered point clouds straight into training. Two separate jobs happen here: **cleaning** (removing bad data) and **feature engineering + selection** (deciding what extra signal, beyond raw `x, y, z, intensity`, is actually worth giving the model). Do both once, up front, on a representative sample — not per-batch during training, which would be slow and wouldn't let you inspect the results.

#### 3.1 Data cleaning — remove what shouldn't be there

For every scan, before it enters the dataloader:
- **Drop NaN/Inf points.** A corrupt sensor read or a bad `.bin` parse produces these; they will silently poison a loss computation if not caught.
- **Drop implausible-range points.** Anything with `r = sqrt(x²+y²+z²)` below ~0.5 m (self-hits on the vehicle chassis) or above ~120 m (past the sensor's real range, usually noise) should be dropped or clipped, not trained on.
- **Verify point/label count match.** Every `.bin` file must have the same point count as its paired `.label` file. If they don't match, the scan is corrupt — log it and skip it, don't try to force-align it.
- **Check class balance per scan** (don't silently proceed if a whole sequence has zero dynamic-object points — that tells you something about the sequence, and matters later for §3.3 below and for `train.py`'s loss weighting).

```python
def clean_scan(points, labels):
    """points: (N,4) x,y,z,intensity; labels: (N,) raw class ids. Returns filtered (points, labels), plus a drop count for logging."""
    finite_mask = np.isfinite(points).all(axis=1)
    r = np.linalg.norm(points[:, :3], axis=1)
    range_mask = (r > 0.5) & (r < 120.0)
    keep = finite_mask & range_mask
    dropped = len(points) - keep.sum()
    return points[keep], labels[keep], dropped
```
Run this over the full dataset once, log the drop rate per sequence, and sanity-check it — a sequence dropping more than a few percent of its points is worth a manual look before you trust it.

#### 3.2 Feature engineering — derive extra per-point signal

Raw `(x, y, z, intensity)` is not the only usable signal in a point cloud. Compute these candidate features for every point (cheaply, with vectorized NumPy/SciPy — never a Python loop over points):

```python
from scipy.spatial import cKDTree

def engineer_features(points):
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    r = np.sqrt(x**2 + y**2 + z**2)
    azimuth = np.arctan2(y, x)                       # bearing angle, radians
    elevation = np.arcsin(np.clip(z / np.maximum(r, 1e-6), -1, 1))

    # local point density: how many neighbors within 0.5m -- sparse far-field points
    # look very different from dense near-field ones, which is exactly the signal
    # the adaptive grid (Member 2) is built around
    tree = cKDTree(points[:, :3])
    neighbor_counts = tree.query_ball_point(points[:, :3], r=0.5, return_length=True)

    return {
        "range": r,
        "azimuth": azimuth,
        "elevation": elevation,
        "local_density": neighbor_counts.astype(np.float32),
    }
```
Also compute **height above ground** (not raw sensor-frame `z`) using the same RANSAC ground-plane fit Member 2 uses (`open3d`'s `segment_plane`) — raw `z` is sensor-mount height, not a physically meaningful "how tall is this thing" value, and every one of these candidate features needs to be judged on the *cleaned* points from §3.1, not the raw scan.

#### 3.3 Feature selection — Information Value (IV) and Weight of Evidence (WoE)

You now have several candidate features (`range`, `azimuth`, `elevation`, `local_density`, `height_above_ground`, plus normalized `intensity`). Don't just concatenate all of them onto the model input and hope — measure which ones actually carry predictive signal for the classes you care about, and drop the ones that don't. More input channels that carry no signal just add noise and training time.

**The method — IV/WoE, adapted from classical feature-selection practice:**

1. **Bin every continuous feature first.** IV/WoE are computed per-bin, not on raw continuous values — a continuous feature has to be discretized before this analysis means anything. Use **quantile (equal-frequency) binning**, not equal-width, because LiDAR feature distributions are heavily skewed (e.g. most points are close, few are far; most local densities are low, spikes occur at reflective surfaces):
   ```python
   import pandas as pd

   def bin_feature(values, n_bins=10):
       return pd.qcut(values, q=n_bins, duplicates="drop")
   ```
2. **Pick a target split.** Our label is 6-class (`drivable / static_obstacle_wall / static_obstacle_pole / dynamic_vehicle / dynamic_pedestrian / other_unknown`), and IV is defined for a binary target — so run it **one-vs-rest**, once per split you actually care about separating (e.g. `is_obstacle = label != drivable`, `is_dynamic = label in {dynamic_vehicle, dynamic_pedestrian}`, and if you have time, the finer `is_pedestrian = label == dynamic_pedestrian` vs. `is_vehicle = label == dynamic_vehicle`). A feature only needs to clear the bar for *one* of these splits to be worth keeping.
3. **Compute WoE per bin, then IV as the weighted sum:**
   ```python
   def compute_iv(feature_values, target_binary, n_bins=10):
       df = pd.DataFrame({"bin": bin_feature(feature_values, n_bins), "target": target_binary})
       grouped = df.groupby("bin", observed=True)["target"].agg(["sum", "count"])
       grouped["non_event"] = grouped["count"] - grouped["sum"]

       total_event = grouped["sum"].sum()
       total_non_event = grouped["non_event"].sum()

       pct_event = grouped["sum"] / max(total_event, 1)
       pct_non_event = grouped["non_event"] / max(total_non_event, 1)

       # avoid log(0) for empty bins
       eps = 1e-6
       woe = np.log((pct_event + eps) / (pct_non_event + eps))
       iv_per_bin = (pct_event - pct_non_event) * woe
       return iv_per_bin.sum(), woe
   ```
4. **Interpret the IV score** (standard reference thresholds — apply the same table here):

   | IV range | Meaning |
   |---|---|
   | < 0.02 | Not useful — drop the feature |
   | 0.02 – 0.1 | Weak — keep only if you have few candidate features |
   | 0.1 – 0.3 | Medium predictive power — keep |
   | 0.3 – 0.5 | Strong — keep, this is a good feature |
   | > 0.5 | Suspiciously strong — before trusting it, check for label leakage (e.g. did you accidentally compute the feature *using* the ground-truth label?) |

5. **Run this once**, on a sampled subset (e.g. 5,000–10,000 points drawn across multiple sequences — not the full multi-million-point dataset; this is exploratory analysis, not a per-batch operation), for every candidate feature against every target split. Save the result as a small report:
   ```python
   # data/feature_iv_report.csv
   # feature,split,iv,decision
   # height_above_ground,is_obstacle,0.41,KEEP
   # local_density,is_obstacle,0.18,KEEP
   # azimuth,is_obstacle,0.01,DROP
   # ...
   ```
6. **Only the kept features** get concatenated onto `(x, y, z, intensity)` as extra input channels. Document the final decided feature vector shape (e.g. "7 channels: x, y, z, intensity, height_above_ground, local_density, range") in this file and tell Members 2 and 4 — a changed input shape is the kind of thing that has to go through the contract-change process in `team_tasks/00_interfaces_and_handoff.md`, same as any other shape change, **if** it affects what you hand downstream. (Note: if these engineered features are only used *inside* your model and don't change `classify()`'s public signature in §Interface contract below, you don't need to renegotiate the contract — only the final `labels, confidence` output is what Members 2/3 actually consume.)

**Common mistakes this catches:** feeding in a feature that turns out to have near-zero IV (wasted model capacity and training time); accidentally computing a feature from information the model wouldn't have at inference time (leakage, showing up as a suspiciously high IV); binning with fixed-width bins on a skewed distribution and getting a handful of nearly-empty bins that make the WoE numbers meaningless.

### 4. Build the dataloader
Build this on top of the cleaned points and the selected feature set from step 3 — don't load raw `.bin`/`.label` files directly into training.
```python
class SemanticKITTIDataset(Dataset):
    def __init__(self, root, sequences, mapping):
        self.samples = []
        for seq in sequences:
            velo_dir = f"{root}/sequences/{seq:02d}/velodyne"
            label_dir = f"{root}/sequences/{seq:02d}/labels"
            for fname in sorted(os.listdir(velo_dir)):
                idx = fname.split(".")[0]
                self.samples.append((f"{velo_dir}/{idx}.bin", f"{label_dir}/{idx}.label"))
        self.mapping = mapping

    def __getitem__(self, i):
        velo_path, label_path = self.samples[i]
        points = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)   # x,y,z,intensity
        raw_labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF     # lower 16 bits
        points, raw_labels, _ = clean_scan(points, raw_labels)             # 3.1
        labels = remap_labels(raw_labels, self.mapping)
        extra_features = engineer_features(points)                        # 3.2, filtered to the kept set from 3.3
        return points, labels, extra_features

    def __len__(self):
        return len(self.samples)
```

### 5. Train the segmentation model
- Model choice: PointNet++ or a Sparse Convolutional Network (`spconv` / MinkowskiEngine). Start with PointNet++ — simpler to get training end-to-end, swap to SparseConv later if you need more speed/accuracy.
- **Split**: train on sequences 00–07, 09–10; validate on **sequence 08** (the standard SemanticKITTI convention — keeps your numbers comparable to published results).
- **Class imbalance**: drivable points vastly outnumber dynamic-object points in almost every scan — use a class-weighted loss (inverse frequency weighting) or you'll get a model that's great at "drivable" and useless at the class that matters most for safety.
- Report per-class IoU and overall **mIoU** — this is your headline accuracy number for the pitch.
- Cross-check on nuScenes-mini's val split to show the model generalizes beyond one sensor/geography.

### 6. Ship a Day-1 placeholder
Before the real model is trained, give Members 2 & 3 something to build against immediately:
```python
def placeholder_classify(points):
    z = points[:, 2]
    labels = np.where(z < -1.3, 0, 1)  # crude ground-height threshold
    return labels
```
This unblocks the whole team in week 1 while your real model trains in the background. Do this **today**, regardless of how far along steps 1–5 are.

---

## Interface contract (what you deliver)

**Function signature:** `classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]`

- Input: raw points `(x, y, z, intensity)`
- Output: per-point class (`0-5`, the 6-class scheme — never `255`, that's training-only) + a confidence score per point (`0.0–1.0`)

Tell Member 4 (Systems Integration) this exact signature in week 1 — they'll wrap it as a ROS 2 node. The cleaning and feature engineering in step 3 happen *inside* your training/inference code — they don't change this external signature unless you decide the model needs more than raw `(x,y,z,intensity)` as its own input, in which case say so explicitly to Member 4.

## Tools
PyTorch, `spconv` or MinkowskiEngine, Open3D, SemanticKITTI/nuScenes/CARLA, scikit-learn (metrics), pandas + SciPy (cleaning, feature engineering, and the IV/WoE analysis in step 3).

## Common pitfalls

- **Computing IV on unbinned continuous data.** The formula is meaningless without binning first — always `pd.qcut` (or an equivalent quantile bin) before computing WoE.
- **Running the IV analysis on the full dataset instead of a sample.** It's an exploratory, one-time analysis step — a few thousand sampled points across multiple sequences is enough, and re-running it on millions of points wastes time for no extra insight.
- **A feature with IV > 0.5 is a leakage red flag, not a win.** Check whether it was computed using information (directly or indirectly) derived from the ground-truth label before trusting it.
- **Assuming intensity is on the same scale across datasets.** SemanticKITTI's intensity is already normalized to roughly `[0,1]`; nuScenes and CARLA may return raw, differently-scaled values. Normalize per-source before merging, or a "high intensity" threshold learned on one dataset will mean something completely different on another.
- **Silently dropping mismatched point/label pairs instead of logging them.** A dataset with several corrupt scans and no drop log looks fine until someone asks why the reported point count doesn't match the raw download.
- **Training on an unweighted loss with severe class imbalance.** You'll get a deceptively high overall accuracy number and a near-useless dynamic-object IoU — check per-class IoU, not just mIoU, throughout training, not only at the end.

## Timeline
- **Week 1**: datasets downloaded, placeholder classifier shipped, cleaning + feature engineering + IV analysis done on a sample, dataloader working on the cleaned/engineered features
- **Weeks 2–3**: train the real model, iterate on mIoU
- **End of Week 3**: hand off your trained model's inference function to Member 4 for integration
- **Week 4–5**: help Member 6 with TensorRT/ONNX export of your model

## Deliverables checklist
- [ ] SemanticKITTI + nuScenes-mini + CARLA all set up and readable
- [ ] Class-remapping table for all 3 sources
- [ ] `clean_scan()` applied to every scan, with a logged drop-rate report
- [ ] Candidate features engineered (range, azimuth, elevation, local density, height-above-ground, normalized intensity)
- [ ] `data/feature_iv_report.csv` produced, features kept/dropped by IV threshold, decision documented
- [ ] Working dataloader built on top of cleaned points + selected features
- [ ] Day-1 placeholder classifier shipped to the team
- [ ] Trained model with reported per-class IoU + overall mIoU (val on seq 08), using a class-weighted loss
- [ ] Exported checkpoint (`.pth` and later `.onnx`)
