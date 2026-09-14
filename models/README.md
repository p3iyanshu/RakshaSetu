# Segmentation Model (Member 1)

Implements the interface contract from `team_tasks/01_data_and_segmentation_model.md`
/ `ros2_ws/interfaces.md` section 4:

```python
classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]
```

`points` is raw `(x, y, z, intensity)`. `labels` are in `{0..5}` (see
`data/label_remap.py`'s `RAKSHASETU_CLASS_NAMES` — never `IGNORE_LABEL`,
that's training-only). `confidence` is `[0.0, 1.0]`.

## This is Khushi Singh's approved Step 5 model

`pointnet2_seg.py` / `pointnet2_utils.py` are the handover's unchanged,
approved PointNet++ MSG architecture (see `Member1_HANDOVER_REPORT.md`) —
replaces an earlier, independent SSG model built before the 6-class/
cleaning+feature-engineering pipeline existed.

- `PointNet2SegMSG`: SA1 (MSG, 3 radii 0.5/1.0/2.0m) → SA2 (MSG, 3 radii
  1/2/4m) → SA3 (SSG, r=4m) → SA4 (global) → FP4→FP1 → 6-class head.
  ~1.02M parameters.
- Takes raw ego-frame `xyz` (B,N,3) — **no centroid centering** (tested and
  rejected: FPS/ball-query are translation-invariant already) — plus the 7
  engineered `features` (B,N,7) from `data/feature_engineering.py`.
- Uses genuine iterative farthest-point sampling + ball query (fixed
  physical radius, not k-nearest-neighbors) — the textbook PointNet++
  design, robust to point-density variation by construction.
- `compute_class_weights()` / `build_loss()`: weighted `CrossEntropyLoss`,
  `ignore_index=-1`.

**Known cost:** true FPS's per-layer cost is set by its *output* point count
(1024/256/64), not input N, so shrinking N barely speeds up the model itself
— see `pc_benchmark_step6.py` and the timing notes in `train.py`'s history.
Measured on an RTX 4060 laptop GPU: ~450-520ms/step GPU-bound at batch=8
regardless of N∈{2048,4096,8192}; `num_workers=4` overlaps the ~96ms/frame
CPU-side clean+feature pipeline with GPU compute, landing around 20-25
min/epoch on the full ~19K-scan train split.

## Two implementations of `classify()`

- **`placeholder.py`** — the Day-1 stand-in (adaptive ground-height
  threshold, drivable vs. a generic "static_obstacle_wall" guess for
  everything else). Deliberately low flat confidence (0.3) signals "not a
  real model."
- **`inference.py`** — wraps the trained checkpoint. Reuses
  `cleaning.py`/`feature_engineering.py` unchanged, applies the exact
  per-channel feature normalization computed during training (never
  recomputed at inference), and handles two real subtleties:
  - **cleaning can drop points** (NaN/Inf, or outside the sensor's
    0.9-120m range). To keep `labels`/`confidence` the same length *and
    order* as the input (the contract's hard requirement) without adding
    an `indices` field, dropped points are kept in the output labeled
    `other_unknown` with confidence `0.0` — a sentinel meaning "not a real
    prediction, this point was filtered as sensor noise." Real-data
    validation shows this essentially never triggers, but flagged per
    `interfaces.md`'s own instruction ("if your model drops/filters points
    internally, tell me") — confirm this choice with Member 4 rather than
    treating it as final.
  - **density mismatch, found 2026-09-14, since fixed**: the model is
    trained on 8192-point frames (`dataset.py`'s class-aware sampling), but
    a raw scan has ~100-125K points. `PointNet2SegMSG`'s Set Abstraction
    layers sample a *fixed number* of centers per layer (1024/256/64), not
    a fixed fraction — so at full raw density those centers represent a far
    sparser slice of the scene, and each one's ball query captures many
    more points within its fixed radius than the network ever trained on.
    Measured on a real frame: full-density inference scored mIoU 0.32 with
    `static_obstacle_pole` wildly over-predicted (47% of all points vs. 2.4%
    actual); downsampling to 8192 points first recovered mIoU to 0.62 on the
    same frame. `classify()` now downsamples to `MAX_INFERENCE_POINTS`
    before the forward pass and assigns every point its nearest downsampled
    point's prediction (`scipy.spatial.cKDTree`) — the same fix already
    built for this project's first (retired) architecture in an earlier
    session, never carried over when `pointnet2_seg.py` replaced it. Caught
    because `dashboard/backend/build_demo_data.py`'s regenerated demo feed
    looked implausible (cluster/track counts in the hundreds) — worth
    remembering as a class of bug: a new model swapped in without re-running
    the *specific* check that caught it the first time will reintroduce it.
  Measured latency after the fix: ~208ms/frame on GPU for a full raw
  ~123K-point scan (was ~1s before — downsampling first is also just less
  compute), worse on CPU. The pipeline's Preprocessing stage already
  downsamples before Segmentation in production, so real deployed latency
  should be well under even this, but 208ms is the real worst-case number
  for the team's real-time budget discussion — not yet further optimized
  (that's Member 6's pass, weeks 4-5).
  **Known residual gap**: `classify()` downsamples with plain uniform random
  sampling (no ground truth to do class-aware sampling with, unlike
  training/validation) — this under-represents rare classes like
  `static_obstacle_pole`/`dynamic_pedestrian` more than training-time
  sampling does, which is part of why `dashboard/backend/data/demo_sequence.json`'s
  average per-frame mIoU (0.558) reads lower than the checkpoint's held-out
  validation mIoU (0.868) — see that file's own `meta.note`. For the pitch,
  the held-out validation number is the real accuracy figure.

## Training

```bash
python train.py --data-root ../data/semantickitti/dataset
```

Recipe is the handover's proposed Step 6 spec: Adam (betas 0.9/0.999),
initial lr=1e-3, `ReduceLROnPlateau` (mode="max" on val mIoU, factor=0.5,
patience=5, min_lr=1e-6), early stopping patience 10 validation rounds, max
50 epochs, checkpoint = best val mIoU.

- **Real class weights + per-channel feature normalization stats** are
  computed once (from an 800-scan random sample of the actual train split —
  a full ~19K-scan pass would cost about as much CPU time as an entire
  training epoch for numbers that are already stable at this sample size),
  cached to `checkpoints/dataset_stats.json`, and reused identically at
  train/val/inference. The handover explicitly deferred this (its own
  4-frame numbers were flagged "must NOT be reused for real training") —
  this is that step, done for real.
- Metrics: per-class IoU, mIoU, overall accuracy, per-class recall
  (`metrics.py`'s `IoUMeter`) — `IGNORE_LABEL` excluded from all of them.
- `checkpoints/` (gitignored): `last.pth` (every epoch, for `--resume`),
  `best.pth` (highest val mIoU — includes the model weights *and* the
  dataset stats needed to reproduce inference exactly), `history.json`,
  `dataset_stats.json`.
- `--max-train-scans` / `--max-val-scans` cap dataset size for a fast
  sanity run before a real multi-hour training run.

## `pc_benchmark_step6.py`

The handover's standalone CPU timing/memory benchmark (no training, no
optimizer step) — useful for sizing batch/N on a machine without a GPU.
`train.py`'s own steady-state numbers above are the GPU equivalent.

## Next steps

- Cross-check on nuScenes-mini's val split once it's downloaded.
- Export `best.pth` to ONNX/TensorRT for Member 6's optimization pass
  (weeks 4-5) — also the point to revisit `inference.py`'s ~1s/frame number.
