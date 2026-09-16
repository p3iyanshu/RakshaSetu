"""
grid_engine_node.py

Thin wrapper around Member 2's real build_adaptive_grid()
(grid_engine/grid_builder.py) -- adaptive radial/angular binning, 5cm cells
out to 10m coarsening to 50cm at 100m (grid_builder.RANGE_BIN_EDGES), RANSAC
ground-plane height (Open3D), 61.5% fewer occupied cells than a uniform 5cm
grid on the shared mock sequence (HANDOVER_TO_MEMBER4.md SS3).

Publishes one extra field per cell beyond ros2_ws/interfaces.md SS5's
locked five (class/height_max/height_mean/point_count/confidence):
`height_variance`, Member 2's addition (population variance, ddof=0) — kept
on the wire here since it's purely additive (any consumer that doesn't
know about it can ignore it) rather than dropped to stay strictly to the
original five; flagged in HANDOVER_TO_MEMBER4.md as needing confirmation
from the team before being treated as permanently locked.
"""

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas
from grid_builder import build_adaptive_grid

INPUT_TOPIC = "/rakshasetu/segmentation/labels"
OUTPUT_TOPIC = "/rakshasetu/grid/occupancy"


class GridEngineNode(Node):
    def __init__(self):
        super().__init__("grid_engine_node")
        self.subscription = self.create_subscription(String, INPUT_TOPIC, self.on_segmentation, 10)
        self.publisher = self.create_publisher(String, OUTPUT_TOPIC, 10)
        self.get_logger().info(f"grid_engine_node listening on {INPUT_TOPIC}, publishing {OUTPUT_TOPIC}")

    def on_segmentation(self, msg: String):
        data = schemas.parse(msg.data)
        if "points" not in data:
            # Real Member 1 node might not carry points forward — fall back
            # to caching the latest points_preprocessed message here if so.
            self.get_logger().warn("segmentation message has no points field, skipping this frame")
            return

        points = np.asarray(data["points"], dtype=np.float32)
        labels = np.asarray(data["labels"], dtype=np.int64)
        confidence = np.asarray(data["confidence"], dtype=np.float32)

        grid = build_adaptive_grid(points, labels, confidence) if len(points) > 0 else {}

        # JSON keys must be strings — convert (range_bin, angular_bin) tuples
        grid_json_safe = {
            schemas.grid_key(rb, ab): cell for (rb, ab), cell in grid.items()
        }

        out = String()
        out.data = schemas.make_grid_msg(
            grid_json_safe, timestamp=data["timestamp"], frame_id=data["frame_id"]
        )
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = GridEngineNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
