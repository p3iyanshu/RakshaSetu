# RakshaSetu (PS 26053) — Member 1 Handover Report
**From:** Khushi Singh, Member 1 (Data Pipeline & Segmentation Model)
**To:** Team Lead (taking over Step 6 — Training)
**Scope of this handover:** Steps 1–5, complete and approved. Step 6 (training) is NOT started — handed over for you to run.

---

## 1. Project context

RakshaSetu, SIH 2026, PS 26053: "Adaptive Variable-Resolution 2.5D LiDAR Mapping for Dynamic Environment Perception." My responsibility (Member 1) covers the data pipeline and segmentation model: label remapping → cleaning → feature engineering → dataset/dataloader → PointNet++ model → training → evaluation. Steps 1–5 are done; only training and evaluation remain.

---

## 2. What's done — Steps 1–5, all approved

### Step 1 — Label remapping (`label_remap.py`)
Maps raw SemanticKITTI label IDs to RakshaSetu's **locked 6-class scheme**:
```
0 = drivable_terrain
1 = static_obstacle_wall
2 = static_obstacle_pole
3 = dynamic_vehicle
4 = dynamic_pedestrian
5 = other_unknown
IGNORE_LABEL = -1  (raw "unlabeled"/"outlier" classes — excluded from training/eval entirely)
```
Every raw ID is explicitly mapped (no silent defaults); unmapped IDs raise an error rather than being absorbed. Verified against real `.label` files from sequences 00, 03, 08, 09.

### Step 2 — Cleaning (`cleaning.py`)
Two rules only: drop non-finite (x,y,z,intensity) points, and drop points outside the Velodyne HDL-64E's documented valid range (0.9m–120m). Preserves exact point/label correspondence and order. Verified: real observed range across 4 test frames was [1.277m, 80.4m] — comfortably inside the envelope, zero points dropped by the range rule in practice.

### Step 3 — Feature engineering + IV/WoE (`feature_engineering.py`, `iv_woe.py`)
7 per-point features, all currently retained: `range`, `azimuth`, `elevation`, `z_raw`, `height_above_ground`, `local_density`, `intensity`. One-vs-rest IV/WoE analysis was run per class (results are exploratory/provisional, not used to drop any feature).

### Step 4 — Dataset / DataLoader (`dataset.py`)
`SemanticKITTIDataset` (PyTorch). One item = one LiDAR frame, run through the Step 1–3 pipeline, then reduced to a fixed `NUM_POINTS_PER_SAMPLE` (default **8192**, configurable) via **class-aware sampling (Strategy 3, approved)**: IGNORE gets its own natural per-frame proportion (not a fixed %), remaining budget split evenly across whichever of the 6 classes are actually present in that frame. Approved after a real-data comparison against uniform random sampling (`compare_sampling_strategies.py`) showed uniform sampling dropped rare classes like `dynamic_pedestrian` entirely in ~14% of trials.

**Official split (locked):**
- `TRAIN_SEQUENCES = ["00","01","02","03","04","05","06","07","09","10"]`
- `VAL_SEQUENCES = ["08"]`

**Important — there is no separately-saved "cleaned dataset" file.** Cleaning/feature computation happen on-the-fly inside `SemanticKITTIDataset.__getitem__()`, not as a one-time preprocessing pass written to disk. What you're getting is the **raw real SemanticKITTI `.bin`/`.label` files** plus the **unchanged code** that cleans/features/samples them identically every time. This is intentional — it's not a missing deliverable, just flagging it clearly so it's not assumed a separate "clean" dataset file exists somewhere.

### Step 5 — PointNet++ segmentation model (`pointnet2_seg.py`, `pointnet2_utils.py`)
`PointNet2SegMSG`: pure-PyTorch PointNet++ (SA1 MSG → SA2 MSG → SA3 SSG → SA4 global → FP4→FP1 → 6-class head), ~1.02M parameters. Takes raw ego-frame `xyz` (B,N,3) — **no centroid centering** (explicitly tested and rejected: FPS/ball-query are translation-invariant, centering added no benefit) — plus the 7 engineered `features` (B,N,7). Outputs raw per-point logits (B,N,6). `compute_class_weights()` and `build_loss()` (weighted `CrossEntropyLoss`, `ignore_index=-1`) are implemented.

**Verified on 4 real frames** (seq00:002904, seq03:000800, seq08:002902, seq09:001590): correct tensor shapes end to end, forward pass produces finite logits, loss is finite, all 134/134 model parameters received finite gradients on backward. **No training was performed** — this was forward+backward only, no optimizer step, purely to confirm the pipeline and model are wired correctly on real data.

---

## 3. Open items

**Update (2026-09-14), post-training + corrections punch list:**

1. **`compute_class_weights()` convention — RESOLVED, used as-is.** `total / (num_classes * class_count)` was used unchanged for real training; no issue surfaced.
2. **Batch size and N (points/sample) — RESOLVED.** N=8192, batch_size=8 confirmed practical on the actual training GPU (RTX 4060 laptop), ~9-10 min/epoch after the FPS→random-sampling deadline deviation (see `PROJECT_EXECUTION_PLAN.md` v1.2 / commit `b562fdc`).
3. **Class weights and feature-normalization statistics — RESOLVED, but this exact gap recurred once and is worth reading carefully.** First real training run used a fixed 800-scan sample (~4.2% of the 19,130-scan train split) for these stats — an improvement over the original 4-frame dev subset, but a repeat of the same category of mistake this section originally flagged, caught by a post-hoc corrections review (`team_tasks/01_data_and_segmentation_model_CORRECTIONS.md` item #1). Root cause: `compute_dataset_stats()` looped single-threaded, so a full-dataset pass cost as much wall time as a training epoch — that's why 800 was the default, not a considered statistical decision. Fixed by parallelizing it with a `DataLoader`/`num_workers` (commit `fbe4761`), making the full 19,130-scan split affordable (~7.5 min instead of ~30), then recomputing stats from it and fine-tuning (not retraining from scratch) from the existing checkpoint with the corrected weights. Concretely: `dynamic_pedestrian`'s class weight moved from 26.75 (800-scan estimate) to **32.64** (full-dataset) — confirming the small sample had underestimated just how rare that safety-critical class actually is. Resulting checkpoint: mIoU improved **0.8527 → 0.8675**, and `dynamic_pedestrian` IoU specifically improved **0.689 → 0.729** (see §5 below for the full per-class table). **Lesson for whoever touches this next:** any "compute stats/metrics from a sample because the full pass is slow" shortcut should be re-examined once more compute time is available, by default — it's an easy gap to reintroduce without meaning to.
4. **nuScenes-mini / CARLA cross-check — explicitly descoped for the 2026-09-16 internal hackathon**, per corrections item #3. Decision confirmed 2026-09-14: SemanticKITTI-only for this milestone; nuScenes-mini/CARLA generalization cross-check to be picked up after, not silently dropped. `data/class_mapping.py`'s `NUSCENES_NAME_MAP`/`CARLA_MAP` remain as unreviewed mapping-table stubs for when that work resumes.

---

## 4. Hardware / feasibility findings so far

- A CPU-only smoke test (batch=1, N=2048, 4 real frames) ran successfully with finite loss and full gradient flow, but was on a machine not representative of final training hardware.
- A dedicated benchmark script (`pc_benchmark_step6.py`) exists to measure real forward/backward timing and peak RAM at N=2048/4096/8192, batch=1, no optimizer step, using only real frames. **This has not yet been run in a training-representative environment** — that's one of the first things you should do before committing to a training configuration.
- No GPU was available in my testing setup. If you have access to a CUDA GPU, that changes the practical batch size / epoch time considerably — worth checking before assuming CPU-only.

---

## 5. What YOU need to do next (Step 6 — Training)

In order:

1. **Environment check**: confirm CPU/GPU/RAM/disk available wherever you're training, and whether the full dataset (tens of GB) fits and is reachable.
2. **Run `pc_benchmark_step6.py`** on your actual training environment to get real forward/backward timing and memory numbers — use these to decide batch size and whether N=8192 is practical, or whether it should be reduced.
3. **Get the full real SemanticKITTI dataset** (train: 00–07,09,10; val: 08) into your training environment — I'm handing over only what I used for development/verification (raw data + the 4-frame subset), not the full corpus (see §6 below for what to source separately).
4. **Compute real feature-normalization stats** (per-channel mean/std for the 7 features) from the **full real train split only** — save them, and apply identically at train/val/inference. Do not normalize `xyz`.
5. **Recompute real class weights** from the **full real train split only** — discard any numbers derived from the 4-frame subset.
6. **Confirm the class-weight convention** (open item #1 above) before finalizing.
7. **Write/finalize `train.py`**: Adam (betas=0.9,0.999), initial LR=1e-3, `ReduceLROnPlateau` (mode="max" on val mIoU, factor=0.5, patience=5, min_lr=1e-6 — all configurable), early stopping patience ≈10 epochs, max epochs 50 (proposed), checkpoint = best validation mIoU. Metrics: per-class IoU, mIoU, overall accuracy, per-class recall — IGNORE excluded from all of them.
8. **Train**, save the best checkpoint + config + normalization stats + class weights + per-epoch logs.
9. **Evaluate honestly** — especially rare classes (`dynamic_pedestrian`, `static_obstacle_pole`), which the class imbalance analysis in Step 3/4 flagged as the hardest to learn.

---

## 6. What to upload to the shared drive

### A. Code — required, unchanged, all approved
- `label_remap.py`
- `cleaning.py`
- `feature_engineering.py`
- `iv_woe.py`
- `dataset.py`
- `pointnet2_utils.py`
- `pointnet2_seg.py`
- `pc_benchmark_step6.py`
- `interfaces.md` (project contract — do not modify)

### B. Reference/verification scripts — useful context, not required to run anything
- `verify_remap.py`, `verify_cleaning.py`, `verify_features.py`, `verify_dataset.py`, `compare_sampling_strategies.py`

### C. Data — real SemanticKITTI
- **What I have and am including**: the 4 verified real frame pairs (`.bin`+`.label`) for seq 00 (002904), seq 03 (000800), seq 08 (002902), seq 09 (001590), in the exact layout `sequences/<seq>/velodyne/<frame>.bin` + `sequences/<seq>/labels/<frame>.label`. This is enough for him to re-verify the pipeline and run the benchmark, but **NOT enough to train on**.
- **What he still needs to source himself**: the **full** SemanticKITTI train sequences 00–07, 09, 10 and validation sequence 08, same directory layout. I did not have reliable access to download/host the full dataset (tens of GB) from where I was working — flag this clearly to him rather than let him assume the full dataset is in the drive folder. Point him to the official SemanticKITTI dataset page/download, or wherever your team's shared copy already lives (Google Drive folder mentioned earlier in the project, if your team already has one).

### D. This handover report itself
- Include this document as `HANDOVER_REPORT.md` (or similar) at the root of the drive folder so it's the first thing he opens.

---

## 7. Suggested drive folder structure

```
RakshaSetu_Member1_Handover/
├── HANDOVER_REPORT.md              <- this document
├── interfaces.md
├── code/
│   ├── label_remap.py
│   ├── cleaning.py
│   ├── feature_engineering.py
│   ├── iv_woe.py
│   ├── dataset.py
│   ├── pointnet2_utils.py
│   ├── pointnet2_seg.py
│   └── pc_benchmark_step6.py
├── verification_scripts/
│   ├── verify_remap.py
│   ├── verify_cleaning.py
│   ├── verify_features.py
│   ├── verify_dataset.py
│   └── compare_sampling_strategies.py
└── sample_data/
    └── sequences/
        ├── 00/velodyne/002904.bin, 00/labels/002904.label
        ├── 03/velodyne/000800.bin, 03/labels/000800.label
        ├── 08/velodyne/002902.bin, 08/labels/002902.label
        └── 09/velodyne/001590.bin, 09/labels/001590.label
```

---

## 8. One-line summary you can put in your message to him

"Steps 1–5 (label remapping, cleaning, feature engineering, dataset/dataloader, PointNet++ model) are done and verified on real data — model architecture and loss are confirmed working end-to-end with finite gradients, but **no training has happened yet**. You're picking up at Step 6: get the full SemanticKITTI train/val split into your environment, run the included benchmark to size batch/N for your hardware, compute real class weights + normalization stats from the full split, then train. Sample data (4 frames) and all code are in the drive folder; full dataset you'll need to source separately."

---

## 9. Step 6 update (2026-09-14) — training complete, corrections applied

Sections 4–8 above are Khushi's original handover, written before Step 6
started — kept as-is for the record. This section is the actual outcome.

**Full real training run**, on the complete 54GB extracted dataset
(19,130 train / 4,071 val scans, sequences 00–07,09,10 / 08):

- A same-day demo deadline forced one architecture deviation: `farthest_point_sample`
  swapped from true FPS to random sampling (~11x faster per step) — see
  `PROJECT_EXECUTION_PLAN.md` v1.2 and commit `b562fdc`. Documented as
  time-boxed, to revisit post-deadline, not a permanent decision.
- First training pass used class weights/normalization stats from only an
  800-scan sample (~4.2% of train) — caught by a post-hoc corrections
  review (`team_tasks/01_data_and_segmentation_model_CORRECTIONS.md`) as a
  recurrence of the exact gap §3 originally flagged. Fixed by parallelizing
  `compute_dataset_stats()` and recomputing from the **full** 19,130-scan
  train split, then fine-tuning (not retraining from scratch) with the
  corrected weights.

**Final checkpoint (`models/checkpoints/best.pth`) — val on sequence 08:**

| Class | IoU | Recall |
|---|---|---|
| drivable_terrain | 0.934 | 0.967 |
| static_obstacle_wall | 0.877 | 0.944 |
| static_obstacle_pole | 0.891 | 0.944 |
| dynamic_vehicle | 0.950 | 0.971 |
| dynamic_pedestrian | 0.729 | 0.884 |
| other_unknown | 0.823 | 0.893 |
| **mIoU** | **0.868** | |
| **Overall accuracy** | | **0.942** |

`dynamic_pedestrian` — the class the corrections review specifically
flagged as weakest (0.65 IoU on the 800-scan-stats checkpoint) — improved to
0.729 IoU after recomputing stats from the full train split (class weight
moved from 26.75 to the full-dataset-true 32.64). It remains the weakest of
the six classes, which is expected given it's the rarest by far (~40k of
~5.5M valid points in the full-stats sample) — stated honestly here rather
than chased further under deadline pressure, per the corrections review's
own guidance.

**Verified**: `pytest tests/test_contracts.py tracking/tests/ -v` — 19/19
passing, including the real trained-checkpoint contract test.

**A second real bug found and fixed the same day, while regenerating the
dashboard demo feed against this checkpoint**: `models/inference.py` was
running the model on full raw scans (~100-125K points) directly, but
`PointNet2SegMSG` is trained on 8192-point frames — its Set Abstraction
layers sample a *fixed number* of centers per layer regardless of input
size, so at full density those centers represented a far sparser slice of
the scene than in training, a real distribution shift (measured: mIoU 0.32
on a full-density frame, with `static_obstacle_pole` over-predicted at 47%
vs. 2.4% actual). This is the identical class of bug this project's first,
now-retired segmentation architecture had already found and fixed — the fix
didn't carry over when `pointnet2_seg.py` replaced it. Re-applied the same
downsample-then-propagate strategy; recovered to mIoU 0.62 on the same
frame, and ~5x faster as a side effect. See `models/README.md` and commit
`659b58b`. `dashboard/backend/data/demo_sequence.json` regenerated with the
fix — its own `meta.note` field explains why that clip's avg per-frame mIoU
(0.558) still reads below this checkpoint's held-out validation mIoU
(0.868): `classify()` has no ground truth to sample by class with at
inference, unlike training/validation.

**nuScenes-mini / CARLA generalization cross-check**: explicitly descoped
for the 2026-09-16 internal hackathon (decision recorded 2026-09-14, §3
item 4) — SemanticKITTI-only for this milestone.

**`.onnx` export**: still open, as originally scoped — Member 6's
optimization pass, weeks 4-5, not overdue.
