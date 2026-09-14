# Tracking — Member 3: Clustering & Tracking

Groups obstacle points into discrete objects (DBSCAN), tracks them
frame-to-frame (Kalman filter + SORT-style Hungarian association), and
decides static vs. dynamic per the multi-frame, ego-motion-compensated rule
in [`team_tasks/03_clustering_and_tracking.md`](../team_tasks/03_clustering_and_tracking.md)
(v2) and [`ros2_ws/interfaces.md`](../ros2_ws/interfaces.md) §6.

## Files

| File | Task | What it does |
|---|---|---|
| `clustering.py` | 1, 2 | DBSCAN with radial-ring-scaled `eps`; per-cluster centroid/bbox/point_count/dominant_class/mean_confidence |
| `kalman_tracker.py` | 3, 4, 4.5 | Constant-velocity Kalman filter per object, SORT-style association, ego-motion compensation, static/dynamic decision |
| `semantic_kitti_labels.py` | 5 | Real SemanticKITTI raw label ids → Member 1's approved 6-class scheme (`data/label_remap.py`) + ground-truth moving/non-moving flag |
| `ego_motion.py` | 5 | Ego-motion compensation for *offline validation*, using SemanticKITTI's `poses.txt`/`calib.txt` — see the note under §4.5 below for how this relates to the live pipeline's `ego_velocity` |
| `validate_semantic_kitti.py` | 5 | Runs the full pipeline against real data, scores `is_dynamic()` against ground truth |
| `tests/` | all | Unit tests against the shared mock data (fast, no real dataset needed) |

## Class scheme (v2, from `shared/schemas.py` / `interfaces.md` §4)

```
0 = drivable_terrain       (not clustered)
1 = static_obstacle_wall   OBSTACLE_CLASSES — clustered + tracked
2 = static_obstacle_pole   OBSTACLE_CLASSES — clustered + tracked
3 = dynamic_vehicle        OBSTACLE_CLASSES — clustered + tracked
4 = dynamic_pedestrian     OBSTACLE_CLASSES — clustered + tracked
5 = other_unknown          (not clustered — ambiguous, not a real object type)
```

## Quick start

```bash
cd tracking
python clustering.py        # DBSCAN + feature extraction on one mock frame
python kalman_tracker.py    # full tracking over the 20-frame mock sequence
pytest tests/ -v             # unit tests
```

```python
from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES
from kalman_tracker import MultiObjectTracker

tracker = MultiObjectTracker()  # one per sequence/session
for points_xyz, labels, confidence, ego_velocity in frames:   # ego_velocity from Member 4's EgoOdometry, (vx, vy)
    obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)
    cluster_ids = cluster_obstacles(points_xyz[obstacle_mask], labels[obstacle_mask])
    clusters = extract_cluster_features(points_xyz[obstacle_mask], labels[obstacle_mask], confidence[obstacle_mask], cluster_ids)
    tracked_objects = tracker.update(clusters, ego_velocity=ego_velocity)   # -> list[TrackedObject-shaped dict]
```

## Task 4.5 — ego-motion compensation

Every tracked object exposes **two** velocity fields, per `interfaces.md` §6:
- `velocity_relative` — raw Kalman-estimated velocity, directly from
  consecutive centroid measurements in whatever frame they were given (the
  live ego/sensor frame, from Member 4's ROS 2 node). Debugging/visualization
  only.
- `velocity` — `velocity_relative` **plus** `ego_velocity` (from Member 4's
  `EgoOdometry` topic), recovering the object's true world-frame velocity.
  **`is_dynamic` is derived only from this field.**

`MultiObjectTracker.update(clusters, ego_velocity=(0.0, 0.0))` defaults to
`(0.0, 0.0)`, which is correct in two different situations, not just one:
- **Live pipeline, no real odometry yet:** `EgoOdometry`'s CARLA-backed stub
  publishes near-zero until Week 1 Day 5-7, so this is the correct degenerate
  case for now — not a bug, per `interfaces.md` §3/§6.
- **Offline SemanticKITTI validation:** `validate_semantic_kitti.py` uses
  `ego_motion.py` to transform cluster *centroids* into the sequence's fixed
  world frame **before** calling `.update()` (using the dataset's own
  ground-truth poses, not a live odometry estimate). Centroids arriving
  already world-frame means `velocity_relative` and `velocity` are already
  identical without needing a nonzero `ego_velocity` — passing `(0.0, 0.0)`
  there is exactly correct, not a shortcut. This is also why the two
  compensation mechanisms (`ego_motion.py` vs. `ego_velocity`) coexist rather
  than one replacing the other: one is a dataset-validation tool, the other
  is the real runtime API Member 4's node will actually call.

## Validating against real SemanticKITTI data (Task 5)

Not checked into the repo (real dataset, `.gitignore`'d) — extract a frame
range first from the zips:

```python
import zipfile, os
START, N, SEQ = 3615, 100, "00"   # any window; see note below on picking one
OUT = f"tracking/kitti_validation_data/sequences/{SEQ}"
for zf, sub in [("data_odometry_labels.zip", "labels"), ("data_odometry_velodyne.zip", "velodyne")]:
    z = zipfile.ZipFile(zf)
    os.makedirs(f"{OUT}/{sub}", exist_ok=True)
    for i in range(START, START + N):
        name = f"dataset/sequences/{SEQ}/{sub}/{i:06d}.{'label' if sub=='labels' else 'bin'}"
        with z.open(name) as src, open(f"{OUT}/{sub}/{i:06d}.{'label' if sub=='labels' else 'bin'}", "wb") as dst:
            dst.write(src.read())
# also copy dataset/sequences/00/{calib.txt,times.txt} from data_odometry_calib.zip
# and dataset/sequences/00/poses.txt from data_odometry_labels.zip -- needed for ego-motion compensation
```

```bash
python validate_semantic_kitti.py                    # uses tracking/kitti_validation_data/sequences/00 by default
python validate_semantic_kitti.py <seq_dir> <n_frames>
python validate_semantic_kitti.py <seq_dir> <n_frames> --no-compensation   # see why compensation matters, below
```

Pick a frame window that actually has moving objects — SemanticKITTI's
`moving-X` labels are sparse in most of any sequence. A quick scan found
sequence 00 frames 3615-3714 densely populated with `moving-car`/`moving-bicyclist`.

### Findings from this validation (important — read before trusting the numbers)

Running the pipeline against real data (as opposed to only the shared mock
scene) surfaced several real bugs and one class-semantics insight, in order
of discovery:

1. **Ego motion must be compensated, or every static object looks dynamic.**
   Raw KITTI `.bin` scans are given in the LiDAR sensor frame at each
   instant. Since the vehicle itself is driving, a perfectly stationary
   wall's sensor-frame `(x, y)` position keeps changing every frame — first
   validation run: 5% precision, because nearly everything looked "dynamic".
   Fixed by `ego_motion.py` for offline validation (see Task 4.5 section
   above for how this relates to the live `ego_velocity` parameter) — the
   same technique published moving-object-segmentation methods (e.g. LMNet,
   4DMOS) use to evaluate against this dataset.

2. **Cluster in the sensor frame, not the world frame.** `cluster_obstacles`
   scales `eps` by each point's distance from the sensor (LiDAR returns get
   sparser with range). Naively clustering *after* transforming to world
   coordinates breaks that — "distance from a fixed world origin" isn't
   "distance from the sensor" once the vehicle has moved. Fixed by
   clustering in the native sensor frame, then transforming only the
   resulting cluster *centroids* into world coordinates for tracking.

3. **`is_dynamic()` must average the velocity *vector*, not the per-frame
   speed.** `mean(|v_i|)` can't tell "consistently moving" apart from
   "jittering with similar magnitude every frame" — a static object with
   noisy-but-directionless apparent motion still accumulates a nonzero
   "average speed". Averaging the vector first (`|mean(v_i)|`) lets random
   jitter cancel and only real net drift survives.

4. **`static_obstacle_wall`/`static_obstacle_pole` are static by
   definition — don't run the velocity decision on them at all.**
   SemanticKITTI has `moving-car`, `moving-person`, `moving-bicyclist`, etc.,
   but no `moving-building`, `moving-fence`, or `moving-pole` — Member 1's
   approved `data/label_remap.py` confirms wall (`building`, `fence`) and
   pole (`pole`, `traffic-sign`, `trunk`) classes never have a "moving"
   counterpart in the raw taxonomy. A nonzero measured velocity on one of
   these tracks is therefore *guaranteed* to be noise (building-scale
   clusters are especially unstable: DBSCAN redraws their fragment
   boundaries almost every frame purely from occlusion/viewpoint changes as
   the car drives, since they span tens of meters — the mock scene never
   modeled anything that large). `KalmanTrack.is_dynamic()` now returns
   `False` immediately for these classes rather than trusting the velocity
   threshold — this alone raised accuracy from 0.32 to 0.76 and precision
   from 0.047 to 0.107 on the validation set below, with **no change to
   recall** (vehicle/pedestrian tracks, the classes that can genuinely be
   either static or moving, are untouched by this).

**Remaining, harder limitation — read before using these thresholds
anywhere near production:** even with fix #4, `dynamic_vehicle` precision
alone stays low. Raising `velocity_threshold` doesn't help — a sweep from
0.3 to 1.0 m/s (pre-fix-#4 pipeline) left precision flat while recall
collapsed, meaning the false positives aren't "threshold set too low" —
they're a real noise floor in the measurement itself, and this part of the
finding is unrelated to fix #4 (it affects vehicles, which fix #4 doesn't
touch). Root cause, traced by hand-following a single parked car's
world-frame centroid across 25 frames: a newly-detected object's
LiDAR-visible point cloud is *partial* while it's still far away (fewer
beams hit it, coverage biased toward the near-facing surface), and the
apparent centroid drifts by 1-2m as coverage completes while the vehicle
approaches — a real sensing artifact that overlaps the same apparent-speed
range as genuinely slow real motion (starting/stopping traffic, a walking
pedestrian), so no fixed threshold on centroid displacement cleanly
separates them. Current mitigations (`min_frames_for_decision=10`,
`history_maxlen=20` rolling window) reduce but don't eliminate it.

**Suggested next steps** (not implemented — flagging for whoever picks this
up next): track a bounding-box center or a robust box-fit rather than the
raw point-mean centroid; weight the Kalman filter's measurement noise by
cluster point density (sparse/far detections should be trusted less); or
borrow a proper scan-registration/scene-flow signal (ICP per cluster, or a
learned method like the ones cited above) instead of inferring motion purely
from centroid-to-centroid displacement.

### Current numbers (sequence 00, frames 3615-3714, `velocity_threshold=0.3`, `min_frames=10`)

```
scored track-frame decisions: 7468  (tp=205 fp=1707 tn=5432 fn=124)
precision (dynamic): 0.107
recall (dynamic):    0.623
accuracy:            0.755
```

Moving cars/cyclists are recalled reasonably well (~62%); essentially all of
the remaining false-positive mass is `dynamic_vehicle` tracks (parked cars)
hitting the measurement-noise ceiling described above — `static_obstacle_wall`/
`static_obstacle_pole` no longer contribute any false positives at all after
fix #4.

## Interface contract

Delivers `list[TrackedObject]` per frame, matching
[`shared/schemas.py`](../shared/schemas.py) / `interfaces.md` §6 exactly —
verified by [`tests/test_contracts.py`](../tests/test_contracts.py).

## Deliverables checklist (team_tasks/03_clustering_and_tracking.md, v2)

- [x] DBSCAN clustering on obstacle points
- [x] Per-cluster feature extraction
- [x] Kalman filter + SORT-style association across frames
- [x] Static vs. dynamic decision logic (multi-frame, not single-frame)
- [x] Ego-motion compensation: `velocity` (compensated) and
      `velocity_relative` (raw) both exposed, `is_dynamic` derived only from
      the compensated one
- [x] Validated against SemanticKITTI's moving/non-moving ground truth —
      done, with honest results and a documented remaining limitation above

## Known git-hygiene issue (flagging, not fixing unilaterally)

This module's actual code lives on `feature/segmentation-model` (commits
`5dd2156`, `ca61a74`), not `feature/tracking` (still just the initial commit)
— a holdover from the shared-working-directory branch collision documented
in session history. `PROJECT_EXECUTION_PLAN.md`'s Definition of Done still
lists "tracking correctly on `feature/tracking`" as required. Untangling this
needs either a rebase/cherry-pick of the tracking-relevant hunks onto
`feature/tracking`, or a team decision to treat `feature/segmentation-model`
as the de facto integration branch and rename/document it as such — a
git-history decision, not something to do silently.
