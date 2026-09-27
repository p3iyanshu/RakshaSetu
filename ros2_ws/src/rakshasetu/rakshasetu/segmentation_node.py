"""
segmentation_node -- interfaces.md SS4. Thin wrapper around Member 1's
classify() (models/inference.py) -- no segmentation logic lives here.

Subscribes to TOPIC_LIDAR_PREPROCESSED, publishes labels/confidence on
TOPIC_SEGMENTATION, order- and length-preserving per the contract's
"critical rule" (classify() already guarantees this itself -- see that
module's docstring on how it handles points its internal cleaning step
would otherwise drop).

Pitfall (flagged in team_tasks/04's own "Common pitfalls" section): this
import only works if torch + this repo's ML dependencies are visible to
whichever Python actually runs this node. rclpy's interpreter and the
Members 1/2/3 venv are not automatically the same environment -- either
install this repo's requirements into the ROS-visible Python, or run this
node with that venv's interpreter explicitly.
"""
import os
import sys

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "models"))
from inference import classify, DEFAULT_CHECKPOINT  # noqa: E402

from . import topics


class SegmentationNode(Node):
    def __init__(self):
        super().__init__("segmentation_node")
        self.declare_parameter("checkpoint_path", DEFAULT_CHECKPOINT)
        self.checkpoint_path = self.get_parameter("checkpoint_path").value

        self.publisher = self.create_publisher(String, topics.TOPIC_SEGMENTATION, 10)
        self.subscription = self.create_subscription(
            String, topics.TOPIC_LIDAR_PREPROCESSED, self._on_points, 10
        )
        self.get_logger().info(f"segmentation_node: loading checkpoint {self.checkpoint_path}")

    def _on_points(self, msg: String):
        payload = topics.decode(msg.data)
        points = np.asarray(payload["points"], dtype=np.float32)

        if len(points) == 0:
            labels, confidence = np.array([], dtype=np.int64), np.array([], dtype=np.float32)
        else:
            labels, confidence = classify(points, checkpoint_path=self.checkpoint_path)

        out = String()
        out.data = topics.encode({
            "labels": labels,
            "confidence": confidence,
            "timestamp": payload["timestamp"],  # must match the input frame this was computed from
            "frame_id": payload["frame_id"],
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = SegmentationNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
