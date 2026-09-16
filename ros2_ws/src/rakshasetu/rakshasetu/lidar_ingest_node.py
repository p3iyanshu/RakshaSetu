"""
lidar_ingest_node.py

Publishes real (mock-scene) LiDAR frames on a timer, matching the
LidarIngest schema in interfaces.md exactly. Replays
shared/sample_data/npz_frames/frame_0000.npz .. frame_0019.npz in a loop --
the same 20-frame scene (ground plane, 3 walls, 5 poles, 2 walking
pedestrians, 1 driving vehicle) every other member built and validated
against (shared/mock_data.py) -- instead of uniformly-random points, so
downstream stages (especially the real segmentation model, which was never
trained on pure noise) see a scene with actual structure.

Only `points` (x, y, z, intensity) is replayed here -- the npz files also
contain `labels`/`confidence`, but those are that scene generator's OWN
ground truth, used elsewhere for testing grid_engine/tracking in isolation.
Feeding those straight through would skip real segmentation entirely; the
whole point of this pipeline is that segmentation_node.py produces its own
labels/confidence from these points via Member 1's real classify().

>>> SWAP FOR REAL DATA LATER <<<
Replace `_load_frames()` with either (a) a CARLA subscriber once
carla-ros-bridge is wired in (Week 1 Day 5-7 per the roadmap), or (b) a
real SemanticKITTI .bin sequence reader. Everything else in this node (the
publisher, the timer, the topic name) stays the same.
"""

import os

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas
from rakshasetu.repo_integration import REPO_ROOT

TOPIC = "/rakshasetu/lidar/points"
PUBLISH_HZ = 5.0  # frames per second — matches a modest simulated LiDAR rate

NPZ_FRAMES_DIR = os.path.join(REPO_ROOT, "shared", "sample_data", "npz_frames")


def _load_frames(npz_dir=NPZ_FRAMES_DIR):
    """Loads every frame_XXXX.npz in order. Returns a list of (N,4) float32
    point arrays (points only -- see module docstring for why labels/
    confidence aren't carried through from here)."""
    from mock_data import load_npz  # shared/mock_data.py, on sys.path via repo_integration

    if not os.path.isdir(npz_dir):
        raise FileNotFoundError(
            f"lidar_ingest_node: no sample data at {npz_dir} -- "
            "run `python shared/mock_data.py` to generate it"
        )
    filenames = sorted(f for f in os.listdir(npz_dir) if f.endswith(".npz"))
    if not filenames:
        raise FileNotFoundError(f"lidar_ingest_node: {npz_dir} exists but has no .npz frames")

    frames = []
    for fname in filenames:
        points, _labels, _confidence = load_npz(os.path.join(npz_dir, fname))
        frames.append(np.asarray(points, dtype=np.float32))
    return frames


class LidarIngestNode(Node):
    def __init__(self):
        super().__init__("lidar_ingest_node")
        self.publisher = self.create_publisher(String, TOPIC, 10)

        self.frames = _load_frames()
        self.get_logger().info(
            f"lidar_ingest_node: loaded {len(self.frames)} real mock-scene frames from {NPZ_FRAMES_DIR}"
        )

        self.timer = self.create_timer(1.0 / PUBLISH_HZ, self.publish_frame)
        self.frame_count = 0
        self.get_logger().info(f"lidar_ingest_node started, publishing on {TOPIC} at {PUBLISH_HZ} Hz")

    def publish_frame(self):
        points = self.frames[self.frame_count % len(self.frames)]
        msg = String()
        msg.data = schemas.make_lidar_points_msg(points.tolist())
        self.publisher.publish(msg)
        self.frame_count += 1
        if self.frame_count % 25 == 0:
            self.get_logger().info(f"published {self.frame_count} frames ({len(points)} points in this one)")


def main(args=None):
    rclpy.init(args=args)
    node = LidarIngestNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
