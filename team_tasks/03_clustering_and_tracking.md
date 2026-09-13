# Member 3 — Clustering & Tracking Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** groups obstacle points into discrete objects and tells static obstacles apart from dynamic (moving) ones across frames.

---

## Your mission

The segmentation model (Member 1) labels individual *points*. Your job is to turn clusters of those points into *objects* — and then, by watching how each object moves across frames, decide whether it's static (a wall, a pole) or dynamic (a pedestrian, a vehicle).

## Why this matters

A perception system that only says "obstacle" isn't enough for navigation — a planner downstream needs to treat a stationary wall completely differently from a person who might step into the vehicle's path. This static/dynamic split is one of the three core tasks named explicitly in the problem statement.

## You do NOT need to wait for Member 1's real model

Build against mock segmented point clouds (e.g., a few clusters of random points labeled as obstacles) from day one.

---

## Setup — get your environment ready

```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS/Linux:            source .venv/bin/activate

pip install numpy scikit-learn scipy pytest
pip install filterpy   # optional -- only if you'd rather use a library Kalman filter than a hand-rolled one
```
Verify: `python -c "from sklearn.cluster import DBSCAN; from scipy.optimize import linear_sum_assignment; print('ok')"`.

**Starting point for `eps` tuning:** don't guess a single global value — start from Member 2's `range_bin` boundaries as a first approximation, since point density (and therefore the right cluster radius) changes the same way with range that grid resolution does: roughly `eps=0.3` for range_bin 0 (0–10m), `0.6` for range_bin 1, `1.0` for range_bin 2, `1.5` for range_bin 3 at 60–100m. Tune from there against real data rather than shipping these as final.

---

## Task breakdown

### 1. Clustering — group points into candidate objects
Run DBSCAN on the points Member 1 labeled `static_obstacle_wall`, `static_obstacle_pole`, `dynamic_vehicle`, or `dynamic_pedestrian` (skip drivable-terrain and other/unknown points — you don't need to cluster the road, and other/unknown is deliberately ambiguous rather than a real object type to track):
```python
from sklearn.cluster import DBSCAN

def cluster_obstacles(points_xyz, eps=0.5, min_samples=5):
    db = DBSCAN(eps=eps, min_samples=min_samples).fit(points_xyz)
    return db.labels_  # -1 = noise, otherwise cluster id
```
Tune `eps`/`min_samples` per rough distance band — points are naturally sparser far from the sensor, so a single fixed `eps` may over- or under-cluster depending on range. Consider scaling `eps` with the same radial ring boundaries Member 2 uses, for consistency.

### 2. Extract per-cluster features
For each cluster: centroid (x, y, z), bounding box dimensions, point count, dominant class label (from Member 1's per-point labels), mean confidence.

### 3. Track objects across frames
- **Kalman filter** per tracked object: state = `[x, y, vx, vy]`, predict next position each frame, update with the nearest matching detection.
- **Data association** (SORT-style): match this frame's clusters to last frame's tracked objects using IoU or centroid distance + the Hungarian algorithm (`scipy.optimize.linear_sum_assignment`).
- Assign a persistent track ID to each object so it can be followed frame-to-frame.

```python
from scipy.optimize import linear_sum_assignment

def associate(tracks, detections, cost_fn):
    cost_matrix = build_cost_matrix(tracks, detections, cost_fn)  # e.g. centroid distance
    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    return row_ind, col_ind  # matched pairs; unmatched become new tracks or dropped tracks
```

### 4. Static vs. dynamic decision
After tracking an object across several frames, classify it:
```python
def is_dynamic(track, velocity_threshold=0.3, min_frames=5):
    if len(track.history) < min_frames:
        return None  # not enough data yet
    avg_speed = np.mean([np.linalg.norm(v) for v in track.velocity_history])
    return avg_speed > velocity_threshold
```
Don't decide on a single frame — a stationary object can show small apparent motion from sensor noise. Require a minimum number of consistent frames before committing to a static/dynamic label.

### 4.5. Ego-motion compensation — locked in `ros2_ws/interfaces.md` v2 SS6

The ego vehicle is moving, so a cluster's raw, directly-measured velocity (in the vehicle/sensor frame) is **not** the object's true velocity — it's mixed with however fast the vehicle itself is moving. A parked car sitting still in the world will show a large *apparent* velocity as the vehicle drives past it. Deciding `is_dynamic` from that raw number would misclassify plenty of genuinely stationary objects as moving.

Fix: Member 4's `EgoOdometry` topic gives you the ego vehicle's own `(vx, vy)` each frame. Your tracker must expose **two** velocity fields, not one:
- `velocity_relative` — the raw, directly-measured velocity (what your Kalman filter naturally produces from consecutive centroid measurements in the vehicle frame).
- `velocity` — `velocity_relative` **plus** the ego vehicle's own velocity vector, recovering the object's real, world-frame velocity.

```python
def compensate(raw_velocity_xy, ego_velocity_xy):
    """raw_velocity_xy: this track's Kalman-estimated (vx, vy) in the vehicle
    frame. ego_velocity_xy: the ego vehicle's own (vx, vy) this frame, from
    EgoOdometry. Returns the object's true, world-frame velocity."""
    return (raw_velocity_xy[0] + ego_velocity_xy[0], raw_velocity_xy[1] + ego_velocity_xy[1])
```

**`is_dynamic` must be derived from the compensated `velocity` (averaged over the same multi-frame window as Task 4), never from `velocity_relative`** — otherwise every static object in the scene reads as dynamic the instant the vehicle starts moving. Until Member 4's real CARLA/vehicle odometry is live, `EgoOdometry` publishes near-zero, so `velocity` and `velocity_relative` will look identical — that's the correct degenerate case, not a bug; build and test the compensation logic now so it's already correct once real ego motion is flowing in. (If you're validating offline against real SemanticKITTI sequences using the dataset's own ground-truth poses to work in a fixed world frame instead — see `ego_motion.py` — your centroids are already world-frame before they reach the tracker, so passing an all-zero `ego_velocity` there is exactly correct, not a shortcut.)

### 5. Handle SemanticKITTI's built-in ground truth (useful for validation)
SemanticKITTI actually labels some classes as `moving-X` vs. `X` (e.g. `moving-car` vs `car`) — use this as ground truth to validate your tracker's static/dynamic decisions against, rather than only eyeballing it.

---

## Interface contract

**You receive from:** Member 1 — `points (N,4)`, `labels (N,)`, `confidence (N,)`; and Member 4's `EgoOdometry` topic — `linear_velocity (vx, vy, vz)` (§4.5 above).
**You deliver to Members 4 & 5:** a list of tracked objects per frame — this exact shape is already locked in `ros2_ws/interfaces.md` v2 §6:
```python
[
  {
    "track_id": int,
    "class": int,             # 1=static_obstacle_wall, 2=static_obstacle_pole, 3=dynamic_vehicle, 4=dynamic_pedestrian
    "position": (x, y, z),
    "velocity": (vx, vy, vz),           # ego-motion-COMPENSATED -- is_dynamic is derived from this
    "velocity_relative": (vx, vy, vz),   # RAW, before compensation -- debugging/visualization only
    "is_dynamic": bool,
    "confidence": float,
  },
  ...
]
```

## Tools
scikit-learn (DBSCAN), `filterpy` (Kalman filter implementation) or a hand-rolled one, SciPy (Hungarian algorithm for association).

## Common pitfalls

- **ID switching from ungated association.** Matching purely on "nearest centroid" without a maximum-distance gate will happily match a track to a completely unrelated new detection when the real match briefly disappears (occlusion, a missed frame) — cap the cost matrix entry at a max distance/IoU and treat anything beyond it as "no match" (new track or dropped track), not a forced pair.
- **Kalman filter divergence from inconsistent `dt`.** If your state-transition matrix assumes a fixed frame interval but frames actually arrive at irregular intervals (dropped frames, variable processing time), pass the *actual* elapsed time into the predict step rather than hardcoding it.
- **Never pruning dead tracks.** A track that stops receiving matches should be dropped after a few consecutive missed frames — otherwise memory (and the cost-matrix computation) grows unbounded over a long sequence.
- **Deciding static/dynamic from a single frame.** Sensor noise alone can make a stationary object show a small apparent velocity in any one frame — this is exactly why the brief requires a minimum number of *consistent* frames before committing to a label; don't relax that for a demo shortcut.
- **A fixed `eps` across all ranges.** Points are naturally sparser far from the sensor — a single `eps` tuned on near-field data will over-cluster (merge separate distant objects) or under-cluster (near-field objects split into fragments) depending on which range it was tuned on.

## Timeline
- **Week 1**: DBSCAN clustering working on mock data
- **Week 2**: Kalman filter + frame-to-frame association working
- **Week 3**: static/dynamic decision logic + ego-motion compensation (§4.5), validated against SemanticKITTI's moving/non-moving labels; swap mock data for Member 1's real model output
- **Week 4–5**: help with integration/testing once stable

## Deliverables checklist
- [ ] DBSCAN clustering on obstacle points
- [ ] Per-cluster feature extraction
- [ ] Kalman filter + SORT-style association across frames
- [ ] Static vs. dynamic decision logic (multi-frame, not single-frame)
- [ ] Ego-motion compensation: `velocity` (compensated) and `velocity_relative` (raw) both exposed, `is_dynamic` derived only from the compensated one
- [ ] Validated against SemanticKITTI's moving/non-moving ground truth
