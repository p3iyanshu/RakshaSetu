# RakshaSetu — Handover: Members 1-3 → Member 4 (Systems Integration)

**Purpose:** Members 1 (Segmentation), 2 (Grid Engine), and 3 (Tracking) are all functionally done and **already merged into `main`**. This document is what you (Member 4) need to actually wrap each module into a ROS 2 node and wire the pipeline together, per `team_tasks/04_systems_integration_ros2.md`.

**Read this first, then go straight to `team_tasks/04_systems_integration_ros2.md`** — that's your own task brief (workspace setup, CARLA bridge, fusion node). This document only covers what you're receiving from Members 1-3, not your own remaining work.

**If you're looking for `feature/segmentation-model`, `feature/grid-engine`, or `feature/tracking` and can't find them: that's expected, not a problem.** They were merged into `main` and GitHub auto-deleted them afterward — the same thing that happens to any merged branch with that repo setting on. The code isn't missing; it's in `main`. Just build on top of `main` directly, no need to hunt for or recreate those branches.

---

## 0. Merge history (resolved — informational only)

The three PRs below all built on `feature/segmentation-model`, which briefly conflicted with `main` on one file (`PROJECT_EXECUTION_PLAN.md` — `main`'s 2026-09-11 copy vs. `feature/segmentation-model`'s independently-evolving one). **This was resolved and all three PRs have since merged:**

| # | PR | Was | Merged into `main` as |
|---|---|---|---|
| [#1](https://github.com/p3iyanshu/RakshaSetu/pull/1) | Migrate to v2 contract; Member 1 data pipeline + trained model (mIoU 0.868) | `feature/segmentation-model` → `main` | `15b2c7d` |
| [#2](https://github.com/p3iyanshu/RakshaSetu/pull/2) | [GridEngine] Adaptive variable-resolution 2.5D grid engine | `feature/grid-engine` → `feature/segmentation-model` | `f3d1151` |
| [#3](https://github.com/p3iyanshu/RakshaSetu/pull/3) | [Tracking] Clustering + Kalman/SORT tracking, ego-motion compensation, SemanticKITTI validation | `feature/tracking` → `main` | merged |

Also merged since: [#4](https://github.com/p3iyanshu/RakshaSetu/pull/4) (CI fix — installs `torch`, runs the full suite not just contract tests) and [#5](https://github.com/p3iyanshu/RakshaSetu/pull/5) (README repo-layout update). **[#6](https://github.com/p3iyanshu/RakshaSetu/pull/6) (Member 6, security/optimization) is still open as of this update** — not part of what this document covers, but worth knowing it exists.

All contract tests are green on `main` (`pytest tests/test_contracts.py -v`).

---

## 2. Member 1 — Segmentation

**Full detail:** [`Member1_HANDOVER_REPORT.md`](Member1_HANDOVER_REPORT.md) (written for the person who ran training — still the best deep-dive), `models/README.md`.

**Wrap this in `segmentation_node.py`:**
```python
from inference import classify, DEFAULT_CHECKPOINT   # models/inference.py

labels, confidence = classify(points)   # points: (N,4) x,y,z,intensity
# labels: (N,) int in {0..5} -- see 6-class scheme below, never IGNORE_LABEL at inference
# confidence: (N,) float32 in [0,1]
```
Checkpoint lives at `models/checkpoints/best.pth` (`DEFAULT_CHECKPOINT`). Consumes `/rakshasetu/lidar/points_preprocessed`, not raw `LidarIngest` output — per `interfaces.md` §2/§4.

**6-class scheme (locked, `shared/schemas.py` / `interfaces.md` §4):**
```
0 drivable_terrain   1 static_obstacle_wall   2 static_obstacle_pole
3 dynamic_vehicle    4 dynamic_pedestrian     5 other_unknown
```

**Validated performance (sequence 08, held out):** mIoU **0.868**, overall accuracy 0.942. Per-class IoU: wall 0.877, pole 0.891, vehicle 0.950, pedestrian 0.729 (weakest — rarest class, expected), other_unknown 0.823.

**Known limitations — read before wiring:**
- `classify()` internally downsamples to 8192 points (the size it was trained on) and propagates predictions back to the full scan — this is already handled inside `classify()`, you don't need to do anything extra, just don't call some other raw-model entrypoint that skips it (a prior version of this bug caused mIoU to crater to 0.32 on full-density scans; already fixed, see `models/README.md`).
- `.onnx` export not done yet — still PyTorch, still Member 6's Week 4-5 scope.
- Only trained/validated on SemanticKITTI; CARLA/nuScenes cross-check explicitly descoped for this milestone (§3 of the handover report).

---

## 3. Member 2 — Grid Engine

**Full detail:** `grid_engine/README.md`.

**Wrap this in `grid_engine_node.py`:**
```python
from grid_engine.grid_builder import build_adaptive_grid

grid = build_adaptive_grid(points, labels, confidence)   # points (N,4), labels (N,), confidence (N,)
# dict[(range_bin, angular_bin)] -> {"class": int, "height_max": float, "height_mean": float,
#                                     "point_count": int, "confidence": float, "height_variance": float}
```
`height_variance` is an addition beyond `interfaces.md` §5's locked fields — flagged in the PR, confirm with the team before relying on it in the wire format, or just don't publish that field yet if you want to stay strictly to the locked contract.

**Radial bands (`RANGE_BIN_EDGES` in `grid_engine/grid_builder.py`, mirrored as `RING_BOUNDARIES` in `shared/schemas.py` — same values, update both together if they ever change):**
```
(0,2,0.05) (2,5,0.05) (5,10,0.05) (10,20,0.15) (20,35,0.25) (35,55,0.35) (55,80,0.45) (80,100,0.50)
```
5cm cells out to 10m, coarsening to 50cm at 100m. **Tracking's DBSCAN `eps` scales off this exact table** — if you ever change it, tell Member 3 (or re-sync `shared/schemas.py`'s `RING_BOUNDARIES` yourself, same as was done here).

**Benchmarked savings:** 61.5% fewer occupied cells vs. a uniform 5cm-everywhere grid, on the 20-frame shared mock sequence — this is the "compute_savings_pct" number for the pitch/metrics.

**Known limitations:** `fit_ground_plane()` runs once per frame (Open3D RANSAC); if profiling shows it dominating frame time, worth caching across a few frames rather than every frame. Not yet run against Member 1's real `classify()` output — only mock data — but no code change is expected to be needed for that swap.

---

## 4. Member 3 — Tracking

**Full detail:** `tracking/README.md` — read this before trusting any number below, it has the complete "what's solid vs. what isn't" breakdown.

**Wrap this in `tracking_node.py`** (also consumes `ego_odometry_node.py`'s output, per `interfaces.md` §6):
```python
from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES
from kalman_tracker import MultiObjectTracker

tracker = MultiObjectTracker()   # construct once, keep it alive across frames -- it holds track state
# every frame:
obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)          # wall/pole/vehicle/pedestrian only, not drivable/other_unknown
cluster_ids = cluster_obstacles(points[obstacle_mask, :3], labels[obstacle_mask])
clusters = extract_cluster_features(points[obstacle_mask, :3], labels[obstacle_mask], confidence[obstacle_mask], cluster_ids)
objects = tracker.update(clusters, ego_velocity=ego_odometry.linear_velocity[:2])   # (vx, vy) from EgoOdometry

# objects: list[{"track_id": int, "cls": int, "position": (x,y,z),
#                 "velocity": (vx,vy,vz), "velocity_relative": (vx,vy,vz),
#                 "is_dynamic": bool, "confidence": float}]
```
**Use `velocity` (compensated) for anything downstream — never `velocity_relative`.** Until your real `EgoOdometry`/CARLA bridge is live, pass `ego_velocity=(0.0, 0.0)` (the default) — that's the correct degenerate case, not a placeholder to fix later.

**Validated against real SemanticKITTI (sequence 00):** accuracy 0.780, recall 0.463, precision 0.109. Wall/pole classes have **zero** false positives (they're static by definition, handled directly rather than trusted to a velocity threshold). The precision number is dragged down almost entirely by parked-vehicle tracks hitting a real LiDAR partial-visibility sensing artifact — root-caused and documented in `tracking/README.md`, not a mystery, just not fully solved. If this number comes up in the pitch, present it with that context rather than bare.

**Known limitations:**
- The parked-vehicle precision issue above — suggested next steps (bounding-box tracking, density-weighted measurement noise, scan-registration) are in the README if anyone has time to pick it up.
- `dt` (frame interval) is passed explicitly to `MultiObjectTracker(dt=...)` at construction — use real elapsed time between frames from your node's timestamps, not a hardcoded value, or the Kalman filter's velocity estimates will be wrong (see `interfaces.md`'s own "Kalman filter divergence from inconsistent dt" pitfall).

---

## 5. Quick reference — what you're building on top of this

Per `team_tasks/04_systems_integration_ros2.md`, your own remaining work is: ROS 2 workspace + node stubs, CARLA bridge, timing/QoS, and the fusion node (the one piece that's actually yours to write, not just wrapping). `interfaces.md` already has the exact wire schema for every topic these three modules feed into — nothing above changes that contract, this document just tells you where the real functions live and what to expect from them today.

Branch off `main` for your own work (e.g. `feature/ros2-integration`) — everything from Members 1-3 is already there, so there's no upstream branch left to base on or wait for.
