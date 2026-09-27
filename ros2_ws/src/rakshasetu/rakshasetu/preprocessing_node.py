"""
preprocessing_node -- interfaces.md SS2.

Subscribes to TOPIC_LIDAR_RAW, publishes filtered/downsampled points on
TOPIC_LIDAR_PREPROCESSED. Contract requires M <= N (only removes points,
never adds) and that the output timestamp matches the input frame it was
computed from exactly.

What "filtering" means here is kept deliberately narrow: drop non-finite
(NaN/Inf) points and points outside LiDAR's sane valid range, then cap frame
size with a uniform random downsample. It does NOT strip ground points
outright -- segmentation_node's classify() call still needs to see them to
produce the drivable_terrain (class 0) label in the first place. If "ground
filtering" was meant more literally (actually removing the ground plane
here, before segmentation), that changes what segmentation ever gets to
see -- flag to Member 4 before assuming either reading, per interfaces.md's
own "tell me before you build around a different shape" rule.
"""
import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from . import topics

VALID_RANGE_M = (0.9, 120.0)  # matches models/inference.py's own valid-range filter
MAX_POINTS = 40000  # uniform downsample cap; raise/lower once real frame sizes are known


class PreprocessingNode(Node):
    def __init__(self):
        super().__init__("preprocessing_node")
        self._rng = np.random.default_rng(0)
        self.publisher = self.create_publisher(String, topics.TOPIC_LIDAR_PREPROCESSED, 10)
        self.subscription = self.create_subscription(
            String, topics.TOPIC_LIDAR_RAW, self._on_points, 10
        )

    def _on_points(self, msg: String):
        payload = topics.decode(msg.data)
        points = np.asarray(payload["points"], dtype=np.float32)

        finite = np.isfinite(points).all(axis=1)
        r = np.linalg.norm(np.where(finite[:, None], points[:, :3], 0.0), axis=1)
        keep = finite & (r >= VALID_RANGE_M[0]) & (r <= VALID_RANGE_M[1])
        filtered = points[keep]

        if len(filtered) > MAX_POINTS:
            idx = self._rng.choice(len(filtered), size=MAX_POINTS, replace=False)
            filtered = filtered[idx]

        out = String()
        out.data = topics.encode({
            "points": filtered,
            "timestamp": payload["timestamp"],  # must match the input frame -- never re-stamped
            "frame_id": payload["frame_id"],
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = PreprocessingNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
