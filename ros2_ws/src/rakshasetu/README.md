# RakshaSetu ROS 2 Integration Package

**Matches interfaces.md v2.** Seven nodes wired together per `ros2_ws/interfaces.md`, wrapping Members 1-3's real, merged-into-`main` modules (`HANDOVER_TO_MEMBER4.md`).

## What's real vs. stubbed right now

| Node | Status |
|---|---|
| `lidar_ingest_node.py` | **Real mock-scene data.** Replays `shared/sample_data/npz_frames/` (the 20-frame scene every other member built/validated against) in a loop, instead of random points |
| `ego_odometry_node.py` | Stub — publishes near-zero motion. Correct for now: the replayed mock scene is in a fixed world frame with the ego vehicle stationary. Swap for CARLA's real vehicle odometry once the bridge is wired in |
| `preprocessing_node.py` | Naive height-threshold filter — not one of Members 1-3's three delivered modules, ownership was never assigned. Swap for real ground filtering if there's time |
| `segmentation_node.py` | **Real: Member 1's trained model** (`models/inference.py`, mIoU 0.868), if `models/checkpoints/best.pth` exists. Falls back to `models/placeholder.py`'s low-confidence stand-in if the checkpoint (git-ignored) or torch isn't available on this machine |
| `grid_engine_node.py` | **Real: Member 2's adaptive grid engine** (`grid_engine/grid_builder.build_adaptive_grid`) — RANSAC ground plane, 8-band radial resolution, 61.5% fewer cells than a uniform grid |
| `tracking_node.py` | **Real: Member 3's clustering + Kalman/SORT tracker** (`tracking/clustering.py`, `tracking/kalman_tracker.py`), with real ego-motion compensation (from `ego_odometry_node`'s topic, via the tracker's own `ego_velocity` parameter) |
| `fusion_node.py` | **Real logic, mine** — object-to-grid-cell reconciliation (v2 fix #3) plus a live `metrics` field (fps, latency_ms measured for real; miou, compute_savings_pct are Members 1/2's real offline-validated numbers) |

## Prerequisites

- ROS 2 Humble, sourced: `source /opt/ros/humble/setup.bash`
- Python deps for the wrapped modules — **install into the same Python `ros2 run` uses**, not a separate venv (see `team_tasks/04_systems_integration_ros2.md`'s "Python environment conflicts" pitfall):
  ```bash
  pip install -r ../../requirements.txt   # numpy, scipy, scikit-learn, open3d
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  ```
  Without torch or a trained checkpoint at `models/checkpoints/best.pth`, `segmentation_node.py` automatically falls back to the placeholder classifier — the pipeline still runs, just not with the real trained model.

## Build

```bash
# from ros2_ws/
colcon build --symlink-install --packages-select rakshasetu
source install/setup.bash
```

`--symlink-install` matters here: `rakshasetu/repo_integration.py` locates the repo root (`models/`, `grid_engine/`, `tracking/`, `shared/`, `data/`) by climbing up from its own file path, which only resolves correctly if the installed files are symlinks back to this source tree, not copies.

## Run everything at once

```bash
ros2 launch rakshasetu rakshasetu_launch.py
```

You should see all seven nodes log a "listening on... publishing..." line each (`segmentation_node` also logs which classifier it picked — trained model or placeholder fallback).

## Run one node at a time (useful while debugging)

```bash
ros2 run rakshasetu lidar_ingest_node
ros2 run rakshasetu ego_odometry_node
ros2 run rakshasetu preprocessing_node
ros2 run rakshasetu segmentation_node
ros2 run rakshasetu grid_engine_node
ros2 run rakshasetu tracking_node
ros2 run rakshasetu fusion_node
```

## Sanity-check each stage is producing real (not stub) data

With the full pipeline running (`ros2 launch rakshasetu rakshasetu_launch.py`), in separate terminals:

```bash
ros2 node list                              # should list all 7 nodes
ros2 topic list                             # should show all 6 topics
ros2 topic hz /rakshasetu/lidar/points      # should show ~5 Hz

# Segmentation: labels should NOT look uniformly random -- with the real
# model or even the placeholder, most points near the bottom of the scan
# should read 0 (drivable_terrain), not an even random spread across 0-5.
ros2 topic echo /rakshasetu/segmentation/labels --once

# GridEngine: every cell should have all 6 fields, including height_variance
# (Member 2's addition beyond the locked 5). point_count should vary
# cell-to-cell, not be uniformly 1.
ros2 topic echo /rakshasetu/grid/occupancy --once

# Tracking: track_id should stay stable for the same object across
# consecutive echoes (run this twice, a beat apart, and compare) -- that's
# the actual point of tracking vs. per-frame detection. velocity should be
# small/near-zero for parked/static objects even though velocity_relative
# may not be, once EgoOdometry is feeding real nonzero motion.
ros2 topic echo /rakshasetu/tracking/objects --once

# Fusion: some objects should carry grid_range_bin/grid_angular_bin, and
# the grid cell at that same key should carry a matching dynamic_track_id.
# metrics.fps should be nonzero once messages are flowing; metrics.miou /
# compute_savings_pct are fixed real numbers (0.868 / 61.5), not computed
# per-frame -- see schemas.py's SEGMENTATION_MIOU / GRID_COMPUTE_SAVINGS_PCT.
ros2 topic echo /rakshasetu/fusion/output --once
```

If `fusion/output` is publishing with a non-empty `objects` list and cells
carrying `dynamic_track_id`, real data is flowing through the entire chain
end to end.

## Known limitations of this version (intentional, see comments in-file)

- Messages are JSON-over-`std_msgs/String`, not real custom `.msg` types —
  see `msg/README.md` for why, and when to upgrade
- `fusion_node.py` merges "latest cached from each topic," not real
  timestamp-synchronized pairs — see the upgrade sketch at the bottom of
  that file for the `message_filters` version (Week 2 per the roadmap)
- No QoS profiles set explicitly yet (defaults are used) — add
  `BEST_EFFORT`/`RELIABLE` profiles per `interfaces.md`/roadmap once the
  pipeline is stable and you're tuning for real-time performance
- `ego_odometry_node.py` is still a near-zero stub — the replayed mock
  scene doesn't need real ego motion to look correct, but a live CARLA feed
  will, once that's wired in
