# Tracking — Member 3: Clustering & Tracking

Groups obstacle points into discrete objects (DBSCAN), tracks them
frame-to-frame (Kalman filter + SORT-style Hungarian association), and
decides static vs. dynamic per the multi-frame rule in
[`team_tasks/03_clustering_and_tracking.md`](../team_tasks/03_clustering_and_tracking.md).

## Files

| File | Task | What it does |
|---|---|---|
| `clustering.py` | 1, 2 | DBSCAN with radial-ring-scaled `eps`; per-cluster centroid/bbox/point_count/dominant_class/mean_confidence |
| `kalman_tracker.py` | 3, 4 | Constant-velocity Kalman filter per object, SORT-style association, static/dynamic decision |
| `semantic_kitti_labels.py` | 5 | Maps real SemanticKITTI raw label ids → our 4-class scheme + ground-truth moving/non-moving flag |
| `ego_motion.py` | 5 | Ego-motion compensation using SemanticKITTI's `poses.txt`/`calib.txt`, needed to validate against real (moving-sensor) data at all |
| `validate_semantic_kitti.py` | 5 | Runs the full pipeline against real data, scores `is_dynamic()` against ground truth |
| `tests/` | all | Unit tests against the shared mock data (fast, no real dataset needed) |

## Quick start

```bash
cd tracking
python clustering.py        # DBSCAN + feature extraction on one mock frame
python kalman_tracker.py    # full tracking over the 20-frame mock sequence
pytest tests/ -v             # unit tests
```

```python
from clustering import cluster_obstacles, extract_cluster_features, STATIC, DYNAMIC
from kalman_tracker import MultiObjectTracker

tracker = MultiObjectTracker()  # one per sequence/session
for points_xyz, labels in frames:                      # per frame, from Member 1/2
    cluster_ids = cluster_obstacles(points_xyz, labels)
    clusters = extract_cluster_features(points_xyz, labels, confidence, cluster_ids)
    tracked_objects = tracker.update(clusters)          # -> list[TrackedObject-shaped dict]
```

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
`moving-X` labels are sparse in most of any sequence. A quick scan (see git
history / session notes) found sequence 00 frames 3615-3714 densely
populated with `moving-car`/`moving-bicyclist`.

### Findings from this validation (important — read before trusting the numbers)

Running the pipeline against real data (as opposed to only the shared mock
scene) surfaced three real bugs and one scope decision, in order of
discovery:

1. **Ego motion must be compensated, or every static object looks dynamic.**
   Raw KITTI `.bin` scans are given in the LiDAR sensor frame at each
   instant. Since the vehicle itself is driving, a perfectly stationary
   wall's sensor-frame `(x, y)` position keeps changing every frame — first
   validation run: 5% precision, because nearly everything looked
   "dynamic". Fixed by `ego_motion.py`, which uses SemanticKITTI's
   ground-truth `poses.txt` + `calib.txt` (`Tr:`) to transform points into a
   fixed world frame before tracking — the same technique published
   moving-object-segmentation methods (e.g. LMNet, 4DMOS) use to evaluate
   against this dataset. **The live pipeline doesn't do this itself** — it
   trusts incoming point clouds are already stabilized. Integration note for
   Member 4: real deployment needs vehicle odometry/localization feeding an
   equivalent compensation step upstream of tracking; this isn't in today's
   interface contract (`shared/schemas.py`).

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
   jitter cancel and only real net drift survives. This alone roughly halved
   the false-positive rate on parked cars/buildings.

4. **Large extended structures (building/fence/vegetation) aren't discrete
   objects and shouldn't be clustered as ones.** They span tens of meters;
   DBSCAN redraws their fragment boundaries differently almost every frame
   purely from occlusion/viewpoint changes as the car drives, which makes
   per-frame centroids of those fragments inherently unstable no matter how
   `eps` is tuned. The mock scene never modeled anything like this either —
   only compact walls and poles. `semantic_kitti_labels.py` now excludes
   these raw classes from the simplified `STATIC_OBSTACLE` scheme entirely;
   that's occupancy-grid territory (Member 2), not object tracking.

**Remaining, harder limitation — read before using these thresholds
anywhere near production:** even after all four fixes, precision on real
data stays low (~0.08 at `velocity_threshold=0.3`) and **does not improve
by raising the threshold** — a sweep from 0.3 to 1.0 m/s left precision flat
while recall collapsed from 0.60 to 0.06. That means the false positives
aren't "threshold set too low" — they're a real noise floor in the
measurement itself. Root cause, traced by hand-following a single parked
car's world-frame centroid across 25 frames: a newly-detected object's
LiDAR-visible point cloud is *partial* while it's still far away (fewer
beams hit it, coverage biased toward the near-facing surface), and the
apparent centroid drifts by 1-2m as coverage completes while the vehicle
approaches — a real sensing artifact, not something a longer averaging
window or a different threshold reliably filters out, because genuinely
slow-moving real objects (starting/stopping traffic, a walking pedestrian)
occupy the same apparent-speed range as this artifact. Current mitigations
(`min_frames_for_decision=10`, `history_maxlen=20` rolling window) reduce
but don't eliminate it.

**Suggested next steps** (not implemented — flagging for whoever picks this
up next): track a bounding-box center or a robust box-fit rather than the
raw point-mean centroid; weight the Kalman filter's measurement noise by
cluster point density (sparse/far detections should be trusted less);
or borrow a proper scan-registration/scene-flow signal (ICP per cluster, or
a learned method like the ones cited above) instead of inferring motion
purely from centroid-to-centroid displacement.

### Current numbers (sequence 00, frames 3615-3714, `velocity_threshold=0.3`, `min_frames=10`)

```
scored track-frame decisions: 4272  (tp=227 fp=2485 tn=1408 fn=152)
precision (dynamic): 0.084
recall (dynamic):    0.599
accuracy:            0.383
```

Compact objects with unambiguous real motion (moving cars/cyclists) are
recalled reasonably well (~60%); the precision number is dragged down almost
entirely by the partial-visibility artifact above, concentrated on newly
detected parked cars specifically (see git history / session notes for the
per-class breakdown: `car` alone accounts for ~1800 of the ~2485 false
positives).

## Interface contract

Delivers `list[TrackedObject]` per frame, matching
[`shared/schemas.py`](../shared/schemas.py) exactly — verified by
[`tests/test_contracts.py`](../tests/test_contracts.py).

## Deliverables checklist (team_tasks/03_clustering_and_tracking.md)

- [x] DBSCAN clustering on obstacle points
- [x] Per-cluster feature extraction
- [x] Kalman filter + SORT-style association across frames
- [x] Static vs. dynamic decision logic (multi-frame, not single-frame)
- [x] Validated against SemanticKITTI's moving/non-moving ground truth —
      done, with honest results and a documented remaining limitation above
