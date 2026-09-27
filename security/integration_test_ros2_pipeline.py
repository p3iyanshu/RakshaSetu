"""
Member 6 integration test: run the REAL ROS 2 pipeline
(ros2_ws/src/rakshasetu -- lidar_ingest -> preprocessing -> segmentation ->
{grid_engine, tracking (+ ego_odometry)} -> fusion) end to end, with SROS2
security enforced, and confirm real output reaches the pipeline's final
output topic correctly.

As of this pass, lidar_ingest_node/ego_odometry_node are self-contained
publishers (they replay shared/mock_data.py's real 20-frame scene / publish
near-zero odometry on their own timers -- see those nodes' own docstrings,
"SWAP FOR REAL DATA LATER" once carla-ros-bridge is wired in). That means
this script does NOT need to inject anything itself -- it just launches the
7 real nodes (no mocks in segmentation/grid_engine/tracking/fusion: these
wrap Members 1-3's actual classify()/build_adaptive_grid()/clustering+
tracking code) and subscribes to the final output topic to confirm real,
well-formed frames come out the other end.

Usage (from repo root, inside a shell with ROS 2 Humble available):
    source /opt/ros/humble/setup.bash
    source ros2_ws/install/setup.bash
    python3 security/integration_test_ros2_pipeline.py [--no-security] [--timeout-s N]

Runs with SROS2 security enforced by default (per security/README.md's
"SROS2" section, keystore at security/sros2_keystore/) unless --no-security
is passed, in which case it's a plain functional test of the pipeline
wiring without the security layer.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
KEYSTORE = os.path.join(HERE, "sros2_keystore")

FUSION_TOPIC = "/rakshasetu/fusion/output"

PIPELINE_NODES = [
    "lidar_ingest_node", "preprocessing_node", "ego_odometry_node",
    "segmentation_node", "grid_engine_node", "tracking_node", "fusion_node",
]

STARTUP_GRACE_S = 12.0  # segmentation_node loads a real torch checkpoint (or falls back to placeholder.py) on first import


class FusionMonitor(Node):
    def __init__(self):
        super().__init__("integration_test_harness")
        self.received_frames = []
        self.subscription = self.create_subscription(String, FUSION_TOPIC, self._on_fusion, 10)

    def _on_fusion(self, msg: String):
        payload = json.loads(msg.data)
        self.received_frames.append(payload)
        self.get_logger().info(
            f"received {FUSION_TOPIC} frame: {len(payload.get('grid', {}))} grid cells, "
            f"{len(payload.get('objects', []))} objects, timestamp={payload.get('timestamp')}, "
            f"metrics={payload.get('metrics')}"
        )


def validate_frame(frame: dict) -> list:
    """Returns a list of problems found (empty == valid). Checked against
    schemas.make_fusion_msg's documented shape (grid, objects, timestamp,
    frame_id, metrics)."""
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
    metrics = frame.get("metrics") or {}
    for field in ("fps", "latency_ms", "miou", "compute_savings_pct"):
        v = metrics.get(field)
        if v is not None and not np.isfinite(v):
            problems.append(f"metrics.{field}: non-finite ({v})")
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
            # REQUIRED on this ROS 2 build, not optional -- see
            # security/README.md's "SROS2" section: matching an enclave by
            # the node's own fully-qualified name alone was found not to
            # work (every node silently resolved to the keystore's ROOT
            # enclave instead and failed to start).
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
    parser.add_argument("--timeout-s", type=float, default=30.0, help="how long to collect fusion frames for (default 30s)")
    args = parser.parse_args()
    use_security = not args.no_security

    print(f"{'=' * 78}\nRakshaSetu ROS 2 pipeline integration test\n"
          f"security enforced: {use_security}   collection window: {args.timeout_s:.0f}s\n{'=' * 78}")

    print(f"\nlaunching {len(PIPELINE_NODES)} real pipeline nodes as subprocesses"
          f"{' with SROS2 enforced' if use_security else ' (no security)'}...")
    procs = launch_pipeline_nodes(use_security)

    try:
        print(f"waiting {STARTUP_GRACE_S:.0f}s for node startup (segmentation_node loads a real torch checkpoint)...")
        time.sleep(STARTUP_GRACE_S)
        for name, p in procs:
            if p.poll() is not None:
                print(f"ERROR: {name} exited early (code {p.returncode}) -- see its log for what broke.")

        if use_security:
            os.environ["ROS_SECURITY_KEYSTORE"] = KEYSTORE
            os.environ["ROS_SECURITY_ENABLE"] = "true"
            os.environ["ROS_SECURITY_STRATEGY"] = "Enforce"
            os.environ["ROS_SECURITY_ENCLAVE_OVERRIDE"] = "/integration_test_harness"
        rclpy.init()

        monitor = FusionMonitor()
        print(f"\ncollecting frames from {FUSION_TOPIC} for {args.timeout_s:.0f}s "
              f"(lidar_ingest_node publishes the shared mock scene on its own timer -- nothing to inject)...")
        deadline = time.time() + args.timeout_s
        while time.time() < deadline:
            rclpy.spin_once(monitor, timeout_sec=0.5)

        received = monitor.received_frames
        monitor.destroy_node()
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
    print(f"frames received on {FUSION_TOPIC}: {len(received)}")
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
            print(f"  frame {i}: OK -- {len(frame['grid'])} grid cells, {len(frame['objects'])} tracked objects, "
                  f"metrics={frame.get('metrics')}")

    if all_problems:
        print(f"\nFAIL: {len(all_problems)} validation problem(s) found.")
        sys.exit(1)

    print(
        f"\nPASS: {len(received)} frames flowed end-to-end through the real "
        f"lidar_ingest -> preprocessing -> segmentation -> grid_engine/tracking -> fusion "
        f"pipeline{' with SROS2 security enforced' if use_security else ''}, well-formed, no NaN/Inf."
    )


if __name__ == "__main__":
    main()
