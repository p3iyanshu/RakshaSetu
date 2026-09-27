# rakshasetu (ROS 2 package)

Thin ROS 2 wrappers around Members 1-3's modules, plus the CARLA-fed
ingest/odometry nodes and the fusion node. Implements the topic contract in
[`ros2_ws/interfaces.md`](../interfaces.md) -- read that first for the wire
schema each topic below carries.

## Wire format

Every topic is a plain `std_msgs/String` carrying the JSON object
documented in `interfaces.md` for that topic -- not a custom `.msg` type.
Deliberate Week 1 shortcut: keeps this a pure `ament_python` package (no
`rosidl` code generation, no C++ toolchain) while every payload still has
to match the documented JSON shape regardless, since the dashboard consumes
the fused output as JSON over WebSocket either way. See `topics.py`'s
module docstring. Revisit as a v3 `interfaces.md` conversation if
JSON (de)serialization of raw point arrays ever shows up as the latency
bottleneck.

## Pipeline

```
lidar_ingest_node ──▶ preprocessing_node ──▶ segmentation_node ──┬──▶ grid_engine_node ──┐
                                                                   └──▶ tracking_node ◀────┤──▶ fusion_node ──▶ (dashboard)
                                            ego_odometry_node ─────────────┘
```

- `lidar_ingest_node` / `ego_odometry_node` consume `carla-ros-bridge`'s
  real `/carla/ego_vehicle/lidar` (sensor_msgs/PointCloud2) and
  `/carla/ego_vehicle/odometry` (nav_msgs/Odometry) topics and republish
  them in this package's JSON schema (Task 3 -- done; see "Running against
  CARLA" below). Everything downstream only ever depends on this package's
  own topic names, so this swap from the earlier `shared/mock_data.py`
  replay stub touched nothing else.
- `segmentation_node`, `grid_engine_node`, `tracking_node` are real thin
  wrappers around `models/inference.py::classify()`,
  `grid_engine/grid_builder.py::build_adaptive_grid()`, and
  `tracking/clustering.py` + `tracking/kalman_tracker.py::MultiObjectTracker`
  respectively -- no reimplemented logic.
- `fusion_node` is the one piece of real logic that's Member 4's own:
  maps each tracked object onto its grid cell using grid_builder's own
  range/angular-bin helpers (so it can't silently drift from GridEngine's
  binning), per `interfaces.md` SS7.
- Nodes that need two independently-published inputs from the same frame
  (`grid_engine_node`, `tracking_node`, `fusion_node`) match them by exact
  `timestamp` string rather than "latest of each" -- see each node's
  docstring. A real `message_filters` sync (Task 4) is the documented
  upgrade path once these topics carry typed messages with a `Header`.

## Build & run

Needs ROS 2 Humble (`ros-humble-desktop`) and this repo's ML dependencies
(`numpy`, `scipy`, `scikit-learn`, `torch` -- no shared `requirements.txt`
exists yet for `models/`/`grid_engine/`/`tracking/`, so match whatever
Members 1-3 used) both visible to the *same* Python interpreter. rclpy's
interpreter and a separate ML `.venv` are not automatically the same
environment -- see "Common pitfalls" in
`team_tasks/04_systems_integration_ros2.md`.

```bash
cd ros2_ws
colcon build --symlink-install
source install/setup.bash

# all seven nodes at once:
ros2 launch rakshasetu rakshasetu.launch.py

# or one at a time, for debugging:
ros2 run rakshasetu lidar_ingest_node
```

Verify data is flowing:
```bash
ros2 topic list
ros2 topic hz /rakshasetu/fusion/output
ros2 topic echo /rakshasetu/lidar/points --once
```

## Running against CARLA (Task 3 -- done)

Architecture: CARLA 0.9.15 runs natively on Windows (`D:\SIH2026\CARLA_0.9.15\WindowsNoEditor\CarlaUE4.exe`
-- a full Unreal Engine renderer, so WSL2 GPU passthrough isn't a reliable
place to run the server itself). `carla-ros-bridge` + ROS 2 run in WSL2 and
connect to the Windows-hosted server over TCP at the WSL2 default-gateway
IP (`ip route show default`, e.g. `172.30.16.1:2000` -- no WSL2 mirrored
networking needed, since CARLA's RPC server binds `0.0.0.0`).

`carla-ros-bridge` is a **separate, third-party underlay workspace**, not
vendored into this repo: `~/carla_ros_bridge_ws` in WSL2's own filesystem
(cloned from `github.com/carla-simulator/ros-bridge`, `--recurse-submodules`
for its `carla_msgs` submodule). It lives outside `D:\SIH2026` deliberately
-- cloning git repos onto a `/mnt/d/...`-mounted Windows drive fails under
WSL2's default DrvFs mount options (`chmod` on `.git/config.lock` isn't
permitted), and the proper fix (`metadata` mount option in `/etc/wsl.conf`)
needs `sudo`. Vendoring a third-party dependency outside your own repo is
also just the normal ROS 2 pattern anyway. `rosdep install --from-paths
ros2_ws/src` will flag this package's `carla_ros_bridge`/`carla_spawn_objects`
exec_depends as unresolvable for the same reason -- expected, not a bug;
they're real dependencies rosdep just can't find because they aren't
registered in rosdistro.

**Three environment issues had to be fixed once, in `~/carla_ros_bridge_ws`'s
WSL2 Python, before the bridge would run at all** (all one-time, already
applied on this machine as of 2026-09-15):
1. The apt-packaged `python3-transforms3d` (0.3.1) calls
   `np.maximum_sctype(np.float)`, both removed in NumPy 2.0 -- fixed with
   `pip install --user --upgrade transforms3d` (0.4.2+, NumPy-2-safe).
2. `ros-humble-cv-bridge`'s compiled `cv_bridge_boost` extension was built
   against NumPy 1.x's C ABI -- a compiled binary, not fixable via pip.
   Fixed by downgrading to `pip install --user "numpy<2"` (landed on
   1.26.4). Re-verified `models/inference.py::classify()` and the rest of
   this repo's pipeline still work correctly on 1.26.4 before relying on it.
3. `carla_ros_bridge/bridge.py` hard-pins `CARLA_VERSION = "0.9.13"` and
   refuses to run against anything else. Patched
   `carla_ros_bridge/src/carla_ros_bridge/CARLA_VERSION` (a plain text file,
   not a version *range* check) to `0.9.15` -- the version actually
   installed and verified (client+server both report 0.9.15; CARLA's
   0.9.13→0.9.15 changelog is additive, no removals in the core
   client/world/sensor API surface this bridge uses). Not risk-free, but
   the only realistic path short of downgrading the whole CARLA install.

**Launch sequence** (WSL2, after `source /opt/ros/humble/setup.bash`):
```bash
# 1. CARLA server already running on Windows (CarlaUE4.exe -quality-level=Low)

# 2. bridge, pointed at the Windows host and the map already loaded
#    (skipping a map switch avoids a slow first-time load that has, once,
#    left the CARLA server itself wedged when the bridge was killed mid-load)
source ~/carla_ros_bridge_ws/install/setup.bash
ros2 launch carla_ros_bridge carla_ros_bridge.launch.py \
  host:=172.30.16.1 port:=2000 town:=Town13 timeout:=120

# 3. spawn the ego vehicle + lidar + odometry pseudo-sensor
#    (config/objects.json -- lean subset of ros-bridge's example: just
#    what interfaces.md actually needs, no cameras/radar/gnss/imu)
ros2 launch carla_spawn_objects carla_spawn_objects.launch.py \
  objects_definition_file:=/mnt/d/SIH2026/ros2_ws/src/rakshasetu/config/objects.json

# 4. NPC traffic for a genuinely dynamic scene (moving vehicles + walkers) --
#    spawns via the raw carla Python API + TrafficManager/walker AI
#    controllers, which then drive server-side; the spawning script itself
#    doesn't need to stay connected afterward.
#    Re-run this after EVERY fresh carla_ros_bridge launch, not just once --
#    restarting the bridge clears previously-spawned actors even when it's
#    pointed at the same already-loaded map (observed 2026-09-15: NPCs
#    spawned in one bridge session were gone after the next bridge restart,
#    with no map reload in between).
python3 /mnt/d/SIH2026/ros2_ws/src/rakshasetu/scripts/spawn_traffic.py --host 172.30.16.1

# 5. this package, now reading the real feed instead of the mock stub
cd /mnt/d/SIH2026/ros2_ws && colcon build --symlink-install
source install/setup.bash
ros2 launch rakshasetu rakshasetu.launch.py
```

A WSL2-specific gotcha worth knowing: a background process started with
`nohup ... & disown` inside one `wsl.exe` invocation still dies when that
invocation's own process exits -- Windows tears down the whole process
group regardless of Linux-level `nohup`. Long-running steps above (bridge,
spawn, this package's own launch) need to stay inside one continuous shell
session for as long as they need to keep running, not `nohup`'d out of a
short-lived one.
