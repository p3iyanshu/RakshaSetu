# Member 4 — Systems Integration Lead (ROS 2 + CARLA)

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** wires every other member's code into one real-time pipeline, and owns the interface contracts everyone else builds against.

---

## Your mission

Members 1, 2, and 3 each build a standalone module. Your job is to connect them into one running system via ROS 2, feed it a live simulated sensor via CARLA, and make sure data flows through with correct timing and no silent mismatches.

## Why your first task is different from everyone else's

**Before writing integration code, your very first job (Day 1–2) is to lock down and document the message schemas every other module builds against.** If you do this late, the other three members will each guess at formats independently and you'll spend the last week fixing mismatches instead of demoing. Do this first, tell everyone, then let them build.

---

## Task breakdown

### 1. Define and document the interface contract (Week 1, Day 1–2)
Write a short `interfaces.md` (or actual ROS 2 `.msg` files) covering:
- `LidarIngest` node output: raw points `(N, 4)` — x, y, z, intensity
- `Segmentation` node output (from Member 1): `labels (N,)`, `confidence (N,)`
- `GridEngine` node output (from Member 2): sparse grid dict, schema `{(ring, angular_bin): {class, height_max, height_mean, point_count, confidence}}`
- `Tracking` node output (from Member 3): list of tracked objects, schema `{track_id, class, position, velocity, is_dynamic, confidence}`
- `Fusion` node output (yours): the final combined 2.5D occupancy-semantic map + object list, streamed to the dashboard

Share this with Members 1, 2, 3 immediately — this is the contract that lets everyone work in parallel without blocking each other.

### 2. Set up the ROS 2 workspace
```
ros2_ws/src/rakshasetu/
├── lidar_ingest_node.py       # reads from CARLA or a dataset, publishes raw points
├── preprocessing_node.py      # ground filtering, downsampling
├── segmentation_node.py       # wraps Member 1's classify() function
├── grid_engine_node.py        # wraps Member 2's grid-building function
├── tracking_node.py           # wraps Member 3's clustering+tracking function
├── fusion_node.py             # combines grid + tracking into final output
└── msg/                       # custom message definitions
```
Each node should be a **thin wrapper** — it calls into the other members' actual functions, it doesn't reimplement their logic. This keeps ownership clean: if Member 2's grid engine has a bug, you fix it in their file, not in your node.

### 3. Bridge CARLA into ROS 2
Use `carla-ros-bridge` so a scripted CARLA scenario (with pedestrians and vehicles moving) publishes into the same topics a real sensor would use. This is what makes your live demo possible without physical hardware.

### 4. Handle timing and synchronization
- Use ROS 2's `message_filters` to synchronize messages across nodes that need to line up in time (e.g., matching a grid frame with the tracking output from the same timestamp)
- Set appropriate QoS profiles (e.g., `BEST_EFFORT` for high-rate sensor data vs. `RELIABLE` for control/config messages)

### 5. Own the fusion node
This is the one piece of logic that's actually yours to write (not just wrapping someone else's function): merge Member 2's grid (terrain/obstacle layer) with Member 3's tracked objects (dynamic layer) into one final map that gets streamed to the dashboard.

### 6. Coordinate integration checkpoints
- **End of Week 3**: pairwise integration — plug Member 1's real model into Member 2's grid engine, plug Member 3's tracker into your ROS graph. Do this before Week 4, not during it.
- **Week 4**: full pipeline running end-to-end, live CARLA feed all the way through to Member 5's dashboard.

---

## Interface contract

**You receive from:** Member 1 (classify function), Member 2 (grid builder function), Member 3 (tracker function)
**You deliver to:** Member 5 — the final fused output, streamed over the WebSocket connection Member 5's backend exposes
**You deliver to:** Member 6 — the whole pipeline, for their security hardening and optimization pass

## Tools
ROS 2 (Humble), `carla-ros-bridge`, `rclpy`, `message_filters`.

## Timeline
- **Week 1**: interface contracts documented and shared (Day 1–2), ROS 2 workspace scaffolded, CARLA bridge running with dummy data flowing through
- **Weeks 2–3**: node wrappers built as each member's real module becomes ready; fusion node logic written
- **End of Week 3**: pairwise integration of real modules
- **Week 4**: full pipeline integration, live feed reaching the dashboard
- **Week 5**: support Member 6's optimization/security work, since it touches your pipeline directly

## Deliverables checklist
- [ ] `interfaces.md` written and shared with the team (Day 1–2, not later)
- [ ] ROS 2 workspace with all node stubs in place
- [ ] CARLA bridge streaming into the pipeline
- [ ] Each node correctly wrapping its owning member's function
- [ ] Fusion node combining grid + tracking output
- [ ] Full pipeline running end-to-end by Week 4
