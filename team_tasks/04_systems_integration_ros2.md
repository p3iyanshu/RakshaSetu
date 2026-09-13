# Member 4 — Systems Integration Lead (ROS 2 + CARLA)

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** wires every other member's code into one real-time pipeline, and owns the interface contracts everyone else builds against.

---

## Your mission

Members 1, 2, and 3 each build a standalone module. Your job is to connect them into one running system via ROS 2, feed it a live simulated sensor via CARLA, and make sure data flows through with correct timing and no silent mismatches.

## Why your first task is different from everyone else's

**Before writing integration code, your very first job (Day 1–2) is to lock down and document the message schemas every other module builds against.** If you do this late, the other three members will each guess at formats independently and you'll spend the last week fixing mismatches instead of demoing. Do this first, tell everyone, then let them build.

Good news: this part is done. `ros2_ws/interfaces.md` (v2, issued 2026-09-12 — 4 corrections found and fixed before anyone built against v1: a missing Preprocessing topic, the GridEngine key fixed from LiDAR-vertical-channel to ground-plane `range_bin`, real Fusion reconciliation instead of blind packaging, and `EgoOdometry`/velocity compensation added to Tracking) and its Python mirror `shared/schemas.py` are both committed and are what everyone else is building against. Your remaining, still-unstarted job is the actual ROS 2 node code and CARLA bridge below — Task 1 in the breakdown is already satisfied, skip straight to Task 2.

---

## Setup — get your environment ready

**If you're on Windows: don't fight native ROS 2 on Windows.** It's technically possible but the tooling, `carla-ros-bridge`, and most tutorials assume Linux. Use **WSL2 with Ubuntu 22.04** instead — it runs a real Linux kernel and ROS 2 installs exactly as documented.

```powershell
# In an elevated PowerShell, one-time setup:
wsl --install -d Ubuntu-22.04
```
Then inside the WSL2 Ubuntu shell:
```bash
# ROS 2 Humble install (Ubuntu 22.04) -- see docs.ros.org for the current exact steps if this drifts
sudo apt update && sudo apt install -y curl gnupg lsb-release
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | sudo tee /etc/apt/sources.list.d/ros2.list
sudo apt update && sudo apt install -y ros-humble-desktop python3-colcon-common-extensions

# Every new terminal:
source /opt/ros/humble/setup.bash
```
If a Docker-based workflow is more comfortable than WSL2, `osrf/ros:humble-desktop` is an equivalent, well-maintained alternative — pick one, don't mix both.

Verify: `ros2 topic list` runs without error, and `ros2 run demo_nodes_cpp talker` / `ros2 run demo_nodes_py listener` in two terminals actually talk to each other.

**Day-1 quick-start (this module has no code yet and blocks integration for everyone):**
```bash
mkdir -p ros2_ws/src/rakshasetu/rakshasetu
cd ros2_ws
colcon build
source install/setup.bash
```
Then create stub node files for every stage in `ros2_ws/src/rakshasetu/rakshasetu/` (`lidar_ingest_node.py`, `preprocessing_node.py`, `segmentation_node.py`, `grid_engine_node.py`, `tracking_node.py`, `fusion_node.py`) — even a node that just publishes a hardcoded mock message on the right topic is enough to unblock a first end-to-end wiring test. Fill in each one for real as the owning member's module becomes ready (§ task breakdown below).

**CARLA + `carla-ros-bridge`:** install inside the same WSL2/Docker environment as ROS 2, matched to the same CARLA version Member 1 pinned (§ their setup section) — a client/server version mismatch is a common, confusing failure mode here.

---

## Task breakdown

### 1. Define and document the interface contract (Week 1, Day 1–2) — DONE, v2
`ros2_ws/interfaces.md` already covers this, at v2:
- `LidarIngest` node output: raw points `(N, 4)` — x, y, z, intensity
- `Preprocessing` node output: filtered/downsampled points — added in v2, this (not raw LidarIngest) is what Segmentation actually consumes
- `EgoOdometry` node output: the ego vehicle's own `linear_velocity`/`angular_velocity` — added in v2, Tracking needs this to compensate for the vehicle's own motion
- `Segmentation` node output (from Member 1): `labels (N,)`, `confidence (N,)`, 6-class scheme
- `GridEngine` node output (from Member 2): sparse grid dict, schema `{(range_bin, angular_bin): {class, height_max, height_mean, point_count, confidence}}` (string-keyed `"{range_bin}_{angular_bin}"` on the wire) — corrected in v2, v1 mistakenly keyed this by LiDAR vertical channel instead of ground-plane position
- `Tracking` node output (from Member 3): list of tracked objects, schema `{track_id, class, position, velocity, velocity_relative, is_dynamic, confidence}` — `velocity`/`velocity_relative` split added in v2 (§4.5 of `team_tasks/03_clustering_and_tracking.md`)
- `Fusion` node output (yours): the final combined 2.5D occupancy-semantic map + object list, with real cross-references (each object tagged with the grid cell it occupies, each occupied cell tagged with the object's track_id) — v2 makes this genuine reconciliation, not blind packaging; streamed to the dashboard

Already shared with Members 1, 2, 3 — this is the contract that lets everyone work in parallel without blocking each other. If a downstream module's real implementation doesn't fit this shape, that's a v3 conversation (see the file's own "what to do if your module doesn't naturally fit this shape" section) — don't let it drift silently.

### 2. Set up the ROS 2 workspace
```
ros2_ws/src/rakshasetu/
├── lidar_ingest_node.py       # reads from CARLA or a dataset, publishes raw points
├── preprocessing_node.py      # ground filtering, downsampling
├── ego_odometry_node.py       # stub for now (near-zero) -- republishes CARLA's real vehicle odometry once the bridge is live
├── segmentation_node.py       # wraps Member 1's classify() function
├── grid_engine_node.py        # wraps Member 2's grid-building function
├── tracking_node.py           # wraps Member 3's clustering+tracking function, consumes ego_odometry_node's output too
├── fusion_node.py             # combines grid + tracking into final output, with real cross-references (v2)
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

## Common pitfalls

- **Forgetting to `source install/setup.bash` in a new terminal.** Every fresh shell needs the ROS 2 environment re-sourced (and your workspace overlay re-sourced after it) — a node that "isn't found" is very often just this.
- **Python environment conflicts between `rclpy` and the ML modules' venv.** ROS 2's Python (the system interpreter it was built against) and the `.venv` Members 1/2/3 use for PyTorch/Open3D/scikit-learn are not automatically the same environment. If a node needs to `import` another member's module directly and hits import errors, either install that module's dependencies into the ROS-visible Python, or keep the coupling looser (subprocess call, or a lightweight local socket/queue) rather than fighting the two environments to be identical.
- **QoS mismatches that fail silently.** A publisher on `BEST_EFFORT` and a subscriber expecting `RELIABLE` (or vice versa) will not throw an error — messages just never arrive, and it looks like the other member's node isn't publishing anything. Check QoS profiles on both ends before assuming the bug is elsewhere.
- **A CARLA client/server version mismatch.** `pip install carla==X` must match the CARLA server binary version exactly — a mismatch typically fails with an unhelpful low-level connection error, not a clear version-mismatch message.
- **Reimplementing another member's logic inside your node "just to get something working."** If you find yourself writing real segmentation or clustering logic inside `segmentation_node.py` or `tracking_node.py`, stop — that logic has an owner, and duplicating it here means two diverging implementations. Wrap their function; if it's not ready yet, use a stub and wait, or use their placeholder if one exists.

## Timeline
- **Week 1**: interface contracts documented and shared (Day 1–2), ROS 2 workspace scaffolded, CARLA bridge running with dummy data flowing through
- **Weeks 2–3**: node wrappers built as each member's real module becomes ready; fusion node logic written
- **End of Week 3**: pairwise integration of real modules
- **Week 4**: full pipeline integration, live feed reaching the dashboard
- **Week 5**: support Member 6's optimization/security work, since it touches your pipeline directly

## Deliverables checklist
- [x] `interfaces.md` written and shared with the team (Day 1–2, not later) — done, at v2 (2026-09-12)
- [ ] ROS 2 workspace with all node stubs in place, including `ego_odometry_node.py`
- [ ] CARLA bridge streaming into the pipeline
- [ ] Each node correctly wrapping its owning member's function
- [ ] Fusion node combining grid + tracking output
- [ ] Full pipeline running end-to-end by Week 4
