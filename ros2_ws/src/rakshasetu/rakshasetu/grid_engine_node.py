"""
grid_engine_node -- interfaces.md SS5. Thin wrapper around Member 2's
build_adaptive_grid() (grid_engine/grid_builder.py) -- no grid-building
logic lives here.

Input is "segmented points (points + labels + confidence, same frame)" per
the contract, but points and labels/confidence arrive on two independent
topics (TOPIC_LIDAR_PREPROCESSED, TOPIC_SEGMENTATION) published by two
different nodes. This node does the minimal real version of Task 4's
"handle timing and synchronization": cache the latest preprocessed-points
message per timestamp, and only build a grid once a segmentation message
with a MATCHING timestamp arrives -- never assume "latest of each" are the
same frame. A full message_filters ApproximateTimeSynchronizer is the
documented upgrade path (team_tasks/04 Task 4) once these topics carry real
typed messages with a Header instead of a JSON string; a std_msgs/String has
no header for message_filters to key off, so exact-string timestamp
matching is what's available for now.
"""
import os
import sys

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "grid_engine"))
from grid_builder import build_adaptive_grid  # noqa: E402

from . import topics

# Bound the cache so a permanently-unmatched frame (e.g. segmentation_node
# not running yet) doesn't grow this without limit. 40 gives generous slack
# at lidar_ingest_node's 2Hz rate -- the old value (20, sized for a since-
# abandoned 10Hz) caused a 100% drop rate once real per-frame pipeline
# latency (JSON overhead + classify()) was measured; see that node's
# PUBLISH_RATE_HZ comment.
MAX_PENDING_FRAMES = 40


class GridEngineNode(Node):
    def __init__(self):
        super().__init__("grid_engine_node")
        self._pending_points = {}  # timestamp -> points payload, waiting for a matching segmentation frame

        self.publisher = self.create_publisher(String, topics.TOPIC_GRID, 10)
        self.points_sub = self.create_subscription(
            String, topics.TOPIC_LIDAR_PREPROCESSED, self._on_points, 10
        )
        self.segmentation_sub = self.create_subscription(
            String, topics.TOPIC_SEGMENTATION, self._on_segmentation, 10
        )

    def _on_points(self, msg: String):
        payload = topics.decode(msg.data)
        self._pending_points[payload["timestamp"]] = payload
        if len(self._pending_points) > MAX_PENDING_FRAMES:
            oldest = next(iter(self._pending_points))
            del self._pending_points[oldest]

    def _on_segmentation(self, msg: String):
        seg = topics.decode(msg.data)
        points_payload = self._pending_points.pop(seg["timestamp"], None)
        if points_payload is None:
            self.get_logger().warn(
                f"grid_engine_node: no preprocessed-points frame matching timestamp {seg['timestamp']}, dropping"
            )
            return

        grid = build_adaptive_grid(points_payload["points"], seg["labels"], seg["confidence"])
        wire_grid = {f"{range_bin}_{angular_bin}": cell for (range_bin, angular_bin), cell in grid.items()}

        out = String()
        out.data = topics.encode({
            "grid": wire_grid,
            "timestamp": seg["timestamp"],
            "frame_id": seg["frame_id"],
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = GridEngineNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
