# Member 1 — Corrections Needed Before Final Submission

**Read this alongside [`01_data_and_segmentation_model.md`](01_data_and_segmentation_model.md) — that file is your original brief; this one is a punch list of things checked against it and found incomplete, inconsistent, or unresolved.** None of this is a rewrite of your work — the pipeline runs, the model trains, and the checkpoint is real. These are specific gaps between what's shipped and what your own brief and your own handover report say should be true, found by reading the actual code and data, not by re-describing the handover.

---

## 1. [HIGH] Class weights and normalization stats are from a 4.2% sample, not the full dataset — your own handover flagged this

`models/train.py::compute_dataset_stats()` is called with `--stats-sample-scans` defaulting to **800 scans**. Your training split (`TRAIN_SEQUENCES = 00,01,02,03,04,05,06,07,09,10`) actually contains **19,130 scans**. So `models/checkpoints/dataset_stats.json` — the class weights and feature-normalization mean/std actually baked into `best.pth` — was computed from about **4.2%** of the training data.

This is exactly the open item your own `Member1_HANDOVER_REPORT.md` §3.3 flagged: *"Class weights and feature-normalization statistics have NOT been computed from the full dataset... those numbers must NOT be reused for real training; they must be recomputed from the full real train split."* Looking at the actual sampled counts, this matters concretely for `dynamic_pedestrian`:

```
class_counts (800-scan sample): drivable=1,568,194  wall=1,465,664  pole=762,585
                                  vehicle=1,022,211  pedestrian=40,042  other=1,568,538
class_weights:                   drivable=0.68       wall=0.73        pole=1.40
                                  vehicle=1.05        pedestrian=26.75  other=0.68
```
`dynamic_pedestrian` is already ~25-40x rarer than every other class in just this sample. A weight this extreme, estimated from the *rarest* class in only 4.2% of the data, has the highest variance of any of the six — small-sample noise here has an outsized effect on training, and it's the safety-critical class the whole PS is scored on.

**Action:** re-run `compute_dataset_stats()` (or `train.py`'s stats step) with `--stats-sample-scans` set to the full 19,130-scan train split (or at least a much larger fraction — a few thousand scans should stabilize the estimate well below 100% if full-dataset compute time is a concern before the 16th). Regenerate `dataset_stats.json`, then retrain and see whether `dynamic_pedestrian` IoU (see #2) moves.

## 2. [HIGH] `dynamic_pedestrian` IoU (0.65) is well below every other class (0.82–0.94)

From the real 15-epoch run (`models/checkpoints/history.json`, last epoch):
```
drivable_terrain: 0.93   static_obstacle_wall: 0.87   static_obstacle_pole: 0.88
dynamic_vehicle:  0.94   dynamic_pedestrian:    0.65   other_unknown:       0.82
```
Your own brief's "Common pitfalls" section says it directly: *"Training on an unweighted loss with severe class imbalance... you'll get a deceptively high overall accuracy number and a near-useless dynamic-object IoU — check per-class IoU, not just mIoU."* mIoU (0.849) looks strong, but the one class where a miss is actually dangerous is the weakest by a wide margin.

**Action:** after fixing #1, re-check whether `dynamic_pedestrian` IoU improves. If it's still low, this is worth a real look before the pitch — a class-weighted loss alone may not be enough given how rare this class is in the raw data.

## 3. [MEDIUM] nuScenes-mini and CARLA were never actually set up — brief requires all three

Your brief's deliverables checklist item 1 is *"SemanticKITTI + nuScenes-mini + CARLA all set up and readable"*, and task item 5 asks for *"cross-check on nuScenes-mini's val split to show the model generalizes beyond one sensor/geography."* Checked the repo directly: there's no nuScenes or CARLA data anywhere (only `data_odometry_{velodyne,labels,calib}.zip`, all SemanticKITTI). `data/class_mapping.py`'s `NUSCENES_NAME_MAP` and `CARLA_MAP` are mapping-table stubs with no dataset behind them, and are themselves marked *"no equivalent approved table exists for those sources yet"* — i.e. not even reviewed.

**Action:** either actually pull nuScenes-mini and run the generalization cross-check before the 16th, or explicitly tell the team this is being descoped for the internal hackathon (and why) so it's a documented decision, not a silently-missed checklist item. Given the timeline, descoping with a one-line note is probably the right call — just make it explicit rather than leaving it to be discovered.

## 4. [LOW/PROCESS] The FPS→random-sampling deviation was well-documented in code, but not in the plan

Commit `b562fdc` ("Deadline deviation: swap true FPS for random sampling") is a good example of how to handle a forced tradeoff — the commit message states the measured cost (11x), the reason (same-day deadline), and what's compromised (sample-center spread, not density-robustness). But `PROJECT_EXECUTION_PLAN.md` §10 says a deviation should be raised and the document itself updated/versioned, and that didn't happen — the plan's `§7` status snapshot and version history still don't mention it.

**Action:** add a line to `PROJECT_EXECUTION_PLAN.md`'s version history (or at least `§7`) referencing this deviation, so anyone reading the plan (a judge, a new team member) isn't surprised by it later. Low effort, avoids the plan silently drifting from what's true, per its own governance rule.

## 5. [LOW, not late yet] `.onnx` export still open

Your checklist's last item (exported checkpoint, `.pth` and later `.onnx`) — `.pth` exists (`best.pth`, `last.pth`), no `.onnx` yet. This is explicitly Week 4–5 scope with Member 6 per your own timeline, so it's not overdue — just noting it's still open so it isn't forgotten once that phase starts.

## 6. Already fixed elsewhere — FYI only, no action needed from you

`tracking/semantic_kitti_labels.py` was importing `data/class_mapping.py`'s `SEMANTICKITTI_MAP` — the table your own docstring in that file already flags `SUPERSEDED, DO NOT USE`. It disagreed with your approved `data/label_remap.py` table on 7 raw ids (sidewalk/other-ground/terrain, bicyclist/moving-bicyclist). This has already been fixed (tracking now imports `label_remap.py`'s `RAW_TO_RAKSHASETU` directly) and verified against real KITTI validation data — just flagging so you know tracking's validation numbers now reflect the same class boundaries your model was actually trained on.

---

## How to confirm you're done

1. Re-run `pytest tests/test_contracts.py -v` and any `models/` tests — must still pass.
2. Re-run training after fixing #1; report the new per-class IoU table (especially `dynamic_pedestrian`) and mIoU.
3. For #3, get an explicit yes/no from the team on descoping nuScenes/CARLA, and either do the cross-check or record the decision.
4. Update `Member1_HANDOVER_REPORT.md`'s "Open items" section to mark #1 resolved (or explicitly still-open with a reason) rather than leaving the original wording in place.
