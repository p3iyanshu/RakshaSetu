"""
Member 6 integration test: run the REAL ROS 2 pipeline
(ros2_ws/src/rakshasetu -- lidar_ingest -> preprocessing -> segmentation ->
{grid_engine, tracking} -> fusion) end to end, with SROS2 security enforced,
and confirm real output reaches the pipeline's final output topic correctly.

Scope, stated honestly: lidar_ingest_node and ego_odometry_node now
subscribe directly to carla-ros-bridge's own topics
(/carla/ego_vehicle/lidar, /carla/ego_vehicle/odometry -- see those nodes'
docstrings), which means a literal "live CARLA" run needs the CARLA
simulator + carla-ros-bridge + carla_spawn_objects actually running. Those
weren't available in this session (CARLA is a ~20GB GPU-rendered simulator;
standing it up cross-boundary between this WSL ROS 2 install and the
Windows-side CARLA binary was out of scope for this pass). Instead, this
script plays the carla-ros-bridge's role itself: it publishes REAL
SemanticKITTI LiDAR scans (not synthetic/random points) as
sensor_msgs/PointCloud2 on the exact topic/format carla-ros-bridge's own
lidar sensor uses (x,y,z,intensity consecutive float32, 16 bytes/point --
see lidar_ingest_node.py's docstring), and a nav_msgs/Odometry on the
matching topic -- then launches the 7 REAL pipeline nodes (no mocks, no
stubs -- the actual segmentation/grid/tracking/fusion wrappers) as
subprocesses and confirms real, well-formed frames come out the other end.
What ISN'T verified here: that carla-ros-bridge's own PointCloud2 encoding
matches this script's assumption byte-for-byte (that's a live-CARLA-only
check) -- flagged as the one remaining gap before a true live-CARLA
rehearsal.

Usage (from repo root, inside a shell with ROS 2 Humble available):
    source /opt/ros/humble/setup.bash
    source ros2_ws/install/setup.bash
    python3 security/integration_test_ros2_pipeline.py [--no-security] [--frames N]

Runs with SROS2 security enforced by default (per security/README.md's
"ROS 2 internal security" section, keystore at security/sros2_keystore/)
unless --no-security is passed, in which case it's a plain functional test
of the pipeline wiring without the security layer.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import PointCloud2, PointField
from std_msgs.msg import String

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
KEYSTORE = os.path.join(HERE, "sros2_keystore")
KITTI_SEQ_DIR = os.path.join(REPO_ROOT, "tracking", "kitti_validation_data", "sequences", "00", "velodyne")

CARLA_LIDAR_TOPIC = "/carla/ego_vehicle/lidar"
CARLA_ODOMETRY_TOPIC = "/carla/ego_vehicle/odometry"
FUSION_TOPIC = "/rakshasetu/fusion/output"

PIPELINE_NODES = [
    "lidar_ingest_node", "preprocessing_node", "ego_odometry_node",
    "segmentation_node", "grid_engine_node", "tracking_node", "fusion_node",
]

FRAME_INTERVAL_S = 4.0  # generous vs. this pipeline's ~0.2-0.4s/frame measured latency (security/benchmark_full_pipeline.py)
STARTUP_GRACE_S = 12.0  # segmentation_node loads a real torch checkpoint on first import -- give it time
TAIL_GRACE_S = 15.0     # extra wait after the last frame is sent, for it to work through the whole pipeline


def real_kitti_frames(n):
    files = sorted(f for f in os.listdir(KITTI_SEQ_DIR) if f.endswith(".bin"))[:n]
    if not files:
        print(f"ERROR: no real SemanticKITTI frames found under {KITTI_SEQ_DIR}")
        sys.exit(1)
    return [np.fromfile(os.path.join(KITTI_SEQ_DIR, f), dtype=np.float32).reshape(-1, 4) for f in files]


def make_pointcloud2(points: np.ndarray, stamp_sec: int, stamp_nanosec: int) -> PointCloud2:
    """x,y,z,intensity consecutive float32 -- matches carla_ros_bridge's
    own lidar `fields` layout (see lidar_ingest_node.py's docstring)."""
    msg = PointCloud2()
    msg.header.stamp.sec = stamp_sec
    msg.header.stamp.nanosec = stamp_nanosec
    msg.header.frame_id = "ego_vehicle/lidar"
    msg.height = 1
    msg.width = len(points)
    msg.fields = [
        PointField(name="x", offset=0, datatype=PointField.FLOAT32, count=1),
        PointField(name="y", offset=4, datatype=PointField.FLOAT32, count=1),
        PointField(name="z", offset=8, datatype=PointField.FLOAT32, count=1),
        PointField(name="intensity", offset=12, datatype=PointField.FLOAT32, count=1),
    ]
    msg.is_bigendian = False
    msg.point_step = 16
    msg.row_step = 16 * len(points)
    msg.is_dense = True
    msg.data = points.astype(np.float32).tobytes()
    return msg


class TestHarness(Node):
    def __init__(self, frames):
        super().__init__("integration_test_harness")
        self._frames = frames
        self._sent = 0
        self.received_fusion_frames = []

        self.lidar_pub = self.create_publisher(PointCloud2, CARLA_LIDAR_TOPIC, 10)
        self.odom_pub = self.create_publisher(Odometry, CARLA_ODOMETRY_TOPIC, 10)
        self.fusion_sub = self.create_subscription(String, FUSION_TOPIC, self._on_fusion, 10)

        self.odom_timer = self.create_timer(0.5, self._publish_odometry)
        self.frame_timer = self.create_timer(FRAME_INTERVAL_S, self._publish_next_frame)

    def _publish_odometry(self):
        msg = Odometry()
        now = self.get_clock().now().seconds_nanoseconds()
        msg.header.stamp.sec, msg.header.stamp.nanosec = now
        msg.twist.twist.linear.x = 2.0  # a plausible slow-roll ego speed, m/s
        self.odom_pub.publish(msg)

    def _publish_next_frame(self):
        if self._sent >= len(self._frames):
            return
        now = self.get_clock().now().seconds_nanoseconds()
        pc2 = make_pointcloud2(self._frames[self._sent], now[0], now[1])
        self.lidar_pub.publish(pc2)
        self.get_logger().info(
            f"published real KITTI frame {self._sent + 1}/{len(self._frames)} "
            f"({len(self._frames[self._sent])} points) at stamp {now[0]}.{now[1]:09d}"
        )
        self._sent += 1

    def _on_fusion(self, msg: String):
        payload = json.loads(msg.data)
        self.received_fusion_frames.append(payload)
        self.get_logger().info(
            f"received /rakshasetu/fusion/output frame: "
            f"{len(payload.get('grid', {}))} grid cells, {len(payload.get('objects', []))} objects, "
            f"timestamp={payload.get('timestamp')}"
        )


def validate_frame(frame: dict) -> list:
    """Returns a list of problems found (empty == valid). Checked against
    interfaces.md SS7's documented fusion output shape."""
    problems = []
    for key in ("grid", "objects", "timestamp", "frame_id"):
        if key not in frame:
            problems.append(f"missing key '{key}'")
    if "grid" in frame and not isinstance(frame["grid"], dict):
        problems.append("'grid' is not a dict")
    if "objects" in frame and not isinstance(frame["objects"], list):
        problems.append("'objects' is not a list")
    for key, cell in frame.get("grid", {}).items():
        for field in ("height_max", "height_mean", "confidence"):
            v = cell.get(field)
            if v is not None and not np.isfinite(v):
                problems.append(f"grid cell {key}: non-finite {field}={v}")
    for obj in frame.get("objects", []):
        for field in ("position", "velocity"):
            if any(not np.isfinite(v) for v in obj.get(field, [])):
                problems.append(f"object track {obj.get('track_id')}: non-finite {field}")
    return problems


def launch_pipeline_nodes(use_security: bool):
    procs = []
    log_dir = os.environ.get("RAKSHASETU_IT_LOG_DIR")
    for name in PIPELINE_NODES:
        env = os.environ.copy()
        if use_security:
            env["ROS_SECURITY_KEYSTORE"] = KEYSTORE
            env["ROS_SECURITY_ENABLE"] = "true"
            env["ROS_SECURITY_STRATEGY"] = "Enforce"
            # REQUIRED on this ROS 2 build, not optional -- matching an
            # enclave by the node's own fully-qualified name alone was
            # found not to work (every node silently resolved to the
            # keystore's ROOT enclave instead and failed to start). See
            # rakshasetu.launch.py's docstring for the same fix applied to
            # the real launch file.
            env["ROS_SECURITY_ENCLAVE_OVERRIDE"] = f"/{name}"
        stdout = open(os.path.join(log_dir, f"{name}.log"), "w") if log_dir else subprocess.DEVNULL
        p = subprocess.Popen(
            ["ros2", "run", "rakshasetu", name],
            env=env, cwd=REPO_ROOT,
            stdout=stdout, stderr=subprocess.STDOUT,
        )
        procs.append((name, p))
    return procs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-security", action="store_true", help="run without SROS2 enforcement (functional-only test)")
    parser.add_argument("--frames", type=int, default=5, help="number of real SemanticKITTI frames to send (default 5)")
    args = parser.parse_args()
    use_security = not args.no_security

    print(f"{'=' * 78}\nRakshaSetu ROS 2 pipeline integration test\n"
          f"security enforced: {use_security}   frames: {args.frames}\n{'=' * 78}")

    frames = real_kitti_frames(args.frames)
    print(f"loaded {len(frames)} real SemanticKITTI frames from {KITTI_SEQ_DIR}")

    print(f"\nlaunching {len(PIPELINE_NODES)} real pipeline nodes as subprocesses"
          f"{' with SROS2 enforced' if use_security else ' (no security)'}...")
    procs = launch_pipeline_nodes(use_security)

    try:
        print(f"waiting {STARTUP_GRACE_S:.0f}s for node startup (segmentation_node loads a real torch checkpoint)...")
        time.sleep(STARTUP_GRACE_S)
        for name, p in procs:
            if p.poll() is not None:
                print(f"ERROR: {name} exited early (code {p.returncode}) -- see below for what broke.")

        # The harness node itself is a DDS participant too -- under Enforce
        # strategy it needs ROS_SECURITY_* (and its OWN enclave override,
        # see launch_pipeline_nodes' comment) set in ITS OWN process env
        # before rclpy.init(), matching the subprocesses' environment.
        if use_security:
            os.environ["ROS_SECURITY_KEYSTORE"] = KEYSTORE
            os.environ["ROS_SECURITY_ENABLE"] = "true"
            os.environ["ROS_SECURITY_STRATEGY"] = "Enforce"
            os.environ["ROS_SECURITY_ENCLAVE_OVERRIDE"] = "/integration_test_harness"
        rclpy.init()

        harness = TestHarness(frames)
        deadline = time.time() + len(frames) * FRAME_INTERVAL_S + TAIL_GRACE_S
        print(f"\nstreaming {len(frames)} frames over ~{len(frames) * FRAME_INTERVAL_S:.0f}s, "
              f"then waiting {TAIL_GRACE_S:.0f}s more for the tail to drain...")
        while time.time() < deadline:
            rclpy.spin_once(harness, timeout_sec=0.5)

        received = harness.received_fusion_frames
        harness.destroy_node()
        rclpy.shutdown()

    finally:
        print("\ntearing down pipeline node subprocesses...")
        for name, p in procs:
            p.terminate()
        time.sleep(1.0)
        for name, p in procs:
            if p.poll() is None:
                p.kill()

    print(f"\n{'=' * 78}\nRESULT\n{'=' * 78}")
    print(f"frames sent: {len(frames)}   frames received on {FUSION_TOPIC}: {len(received)}")
    if not received:
        print("FAIL: no fusion output received at all.")
        sys.exit(1)

    all_problems = []
    for i, frame in enumerate(received):
        problems = validate_frame(frame)
        if problems:
            print(f"  frame {i}: INVALID -- {problems}")
            all_problems.extend(problems)
        else:
            print(f"  frame {i}: OK -- {len(frame['grid'])} grid cells, {len(frame['objects'])} tracked objects")

    if all_problems:
        print(f"\nFAIL: {len(all_problems)} validation problem(s) found.")
        sys.exit(1)

    print(
        f"\nPASS: {len(received)}/{len(frames)} frames flowed end-to-end through the real "
        f"lidar_ingest -> preprocessing -> segmentation -> grid_engine/tracking -> fusion "
        f"pipeline{' with SROS2 security enforced' if use_security else ''}, well-formed, no NaN/Inf."
    )


if __name__ == "__main__":
    main()
