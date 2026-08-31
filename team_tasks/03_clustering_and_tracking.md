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

## Task breakdown

### 1. Clustering — group points into candidate objects
Run DBSCAN on the points Member 1 labeled as `static_obstacle` or `dynamic_object` (skip drivable-terrain points — you don't need to cluster the road):
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

### 5. Handle SemanticKITTI's built-in ground truth (useful for validation)
SemanticKITTI actually labels some classes as `moving-X` vs. `X` (e.g. `moving-car` vs `car`) — use this as ground truth to validate your tracker's static/dynamic decisions against, rather than only eyeballing it.

---

## Interface contract

**You receive from Member 1 (via Member 2's grid, or directly):** `points (N,4)`, `labels (N,)`, `confidence (N,)`
**You deliver to Members 4 & 5:** a list of tracked objects per frame:
```python
[
  {
    "track_id": int,
    "class": int,             # 1=static_obstacle, 2=dynamic_object
    "position": (x, y, z),
    "velocity": (vx, vy),
    "is_dynamic": bool,
    "confidence": float,
  },
  ...
]
```
Confirm this exact schema with Member 4 in week 1.

## Tools
scikit-learn (DBSCAN), `filterpy` (Kalman filter implementation) or a hand-rolled one, SciPy (Hungarian algorithm for association).

## Timeline
- **Week 1**: DBSCAN clustering working on mock data
- **Week 2**: Kalman filter + frame-to-frame association working
- **Week 3**: static/dynamic decision logic, validated against SemanticKITTI's moving/non-moving labels; swap mock data for Member 1's real model output
- **Week 4–5**: help with integration/testing once stable

## Deliverables checklist
- [ ] DBSCAN clustering on obstacle points
- [ ] Per-cluster feature extraction
- [ ] Kalman filter + SORT-style association across frames
- [ ] Static vs. dynamic decision logic (multi-frame, not single-frame)
- [ ] Validated against SemanticKITTI's moving/non-moving ground truth
