# Data Pipeline (Member 1)

Turns raw LiDAR points into the cleaned, feature-engineered, class-remapped
tensors the segmentation model trains on. See
`team_tasks/01_data_and_segmentation_model.md` for the full brief,
`ros2_ws/interfaces.md` for the interface every downstream module reads, and
`Member1_HANDOVER_REPORT.md` (repo root) for the handover this pipeline is
built from.

**This is Khushi Singh's approved Steps 1-5 implementation** (see the
handover report), integrated here and used as-is except where noted below.
It replaced an earlier, independent 4→6-class-only implementation that had
no cleaning or feature-engineering step — that one is gone; this is the one
actually used for training.

## Files, in pipeline order

1. **`label_remap.py`** (Step 1) — raw SemanticKITTI id → RakshaSetu's locked
   6-class scheme (`0=drivable_terrain, 1=static_obstacle_wall,
   2=static_obstacle_pole, 3=dynamic_vehicle, 4=dynamic_pedestrian,
   5=other_unknown, IGNORE_LABEL=-1`). Every documented raw id is explicitly
   mapped; an unmapped id **raises**, it never silently defaults — see the
   module docstring for which judgment calls were made and why.
2. **`cleaning.py`** (Step 2) — drops NaN/Inf points and points outside the
   Velodyne HDL-64E's documented valid range (0.9-120m). Real-data check: this
   essentially never triggers (real KITTI ranges observed well inside the
   envelope) — it's a defensive floor, not a rule tuned to this dataset.
3. **`feature_engineering.py`** (Step 3a) — 7 per-point features: `range`,
   `azimuth`, `elevation`, `z_raw`, `height_above_ground`, `local_density`,
   `intensity`. Ground height is estimated per 1m (x,y) grid cell as the 5th
   percentile of z in that cell (a coarse, O(N) heuristic — not a full
   RANSAC plane fit; see the module docstring for its known weakness in
   sparse far-range cells).
4. **`iv_woe.py`** (Step 3b) — one-vs-rest Information Value / Weight of
   Evidence feature selection (quantile-binned, add-half smoothed). Run via
   `run_iv_analysis.py` (below), not applied per-batch.
5. **`dataset.py`** (Step 4) — `SemanticKITTIDataset`. One item = one frame,
   run through steps 1-3, then reduced to `num_points_per_sample` (default
   8192) via **class-aware sampling**: IGNORE gets its own frame-natural
   proportion, the rest is split evenly across whichever of the 6 classes
   are actually present. Approved after real-data comparison showed uniform
   random sampling drops `dynamic_pedestrian` entirely in ~14% of frames.
   `TRAIN_SEQUENCES` (00-07,09-10) / `VAL_SEQUENCES` (08) is the standard
   SemanticKITTI split.

## `run_iv_analysis.py` — the feature-selection report

The handover's IV/WoE run only ever used a 4-frame verification subset
(explicitly flagged as provisional). This script runs the same, unchanged
`iv_woe.py` against a ~10,000-point sample pooled across 12 frames from 5
different train sequences, and writes `feature_iv_report.csv`.

```bash
python run_iv_analysis.py
```

**Result: all 7 features clear the keep threshold** (max one-vs-rest IV ≥
0.02 for at least one class) — consistent with the handover's provisional
"keep all 7" decision, now backed by a real multi-sequence sample rather
than 4 frames. Several features (`height_above_ground`, `z_raw`, `elevation`
vs. `drivable_terrain`) score IV well above the table's 0.5 "check for
leakage" line — expected here, not a bug: these are purely geometric
features (never touch the ground-truth label), and "height above the
estimated ground ≈ 0" is close to the physical definition of drivable
terrain, so a near-perfect separator is the intended signal. Note also
`dynamic_pedestrian` had only 8 points in the 10K sample (it's genuinely
rare) — its specific IV numbers are noisy and shouldn't be over-trusted.

The approved model (`models/pointnet2_seg.py`) hardcodes a 7-channel feature
input and raises if given anything else — this report is informational, not
a knob that changes the model's input shape on its own; dropping a feature
would need the same team sign-off as any other contract change.

## Getting the real data locally

The three official zips (from semantic-kitti.org) are gitignored at the
repo root. Only sequences **00-10** have ground-truth labels (11-21 are the
unlabeled benchmark test set), so only those need extracting —
`data/semantickitti/dataset/sequences/00..10/` (also gitignored, ~54GB).

## nuScenes-mini / CARLA — not wired up yet

Needs your own action (registration / sim install) before any code here is
useful. `class_mapping.py` (legacy, kept only for its nuScenes/CARLA maps —
superseded for SemanticKITTI by `label_remap.py`) has mapping tables ready
for both once the data exists.

## Quick checks

```bash
python run_iv_analysis.py        # regenerates feature_iv_report.csv
```
