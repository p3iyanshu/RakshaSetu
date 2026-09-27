"""
segmentation_node.py

Thin wrapper around Member 1's real classify() (models/inference.py, the
trained PointNet2SegMSG checkpoint -- mIoU 0.868 on held-out sequence 08,
see HANDOVER_TO_MEMBER4.md SS2 / Member1_HANDOVER_REPORT.md).

Falls back to models/placeholder.py's day-1 stand-in when no checkpoint is
present at models/checkpoints/best.pth -- that path (and *.pth generally)
is git-ignored (.gitignore: "raw LiDAR datasets + trained model artifacts
-- never commit these"), so a fresh clone has no checkpoint until someone
runs models/train.py locally. The fallback keeps the pipeline runnable out
of the box for a live demo even on a machine that never trained the model;
placeholder.py's deliberately low, flat 0.3 confidence is its own built-in
signal to any consumer doing confidence-based filtering that this is a
stand-in, not a real prediction (see models/README.md).
"""

import os

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas
from placeholder import classify as _placeholder_classify

try:
    # inference.py hard-imports torch/scipy -- guarded separately from
    # placeholder's own import above so a machine missing one of those
    # still runs the demo on the placeholder rather than crashing the node
    # at import time.
    from inference import classify as _trained_classify, DEFAULT_CHECKPOINT
    _INFERENCE_IMPORT_ERROR = None
except ImportError as exc:
    _trained_classify, DEFAULT_CHECKPOINT = None, None
    _INFERENCE_IMPORT_ERROR = exc

INPUT_TOPIC = "/rakshasetu/lidar/points_preprocessed"
OUTPUT_TOPIC = "/rakshasetu/segmentation/labels"


class SegmentationNode(Node):
    def __init__(self):
        super().__init__("segmentation_node")

        if _INFERENCE_IMPORT_ERROR is not None:
            self._classify = _placeholder_classify
            self.get_logger().warn(
                f"segmentation_node: models/inference.py failed to import ({_INFERENCE_IMPORT_ERROR}) "
                "-- falling back to models/placeholder.py's low-confidence stand-in"
            )
        elif os.path.exists(DEFAULT_CHECKPOINT):
            self._classify = _trained_classify
            self.get_logger().info(f"segmentation_node: using Member 1's trained model ({DEFAULT_CHECKPOINT})")
        else:
            self._classify = _placeholder_classify
            self.get_logger().warn(
                f"segmentation_node: no checkpoint at {DEFAULT_CHECKPOINT} "
                "(models/checkpoints/ is git-ignored -- run models/train.py to produce one); "
                "falling back to models/placeholder.py's low-confidence stand-in"
            )

        self.subscription = self.create_subscription(String, INPUT_TOPIC, self.on_points, 10)
        self.publisher = self.create_publisher(String, OUTPUT_TOPIC, 10)
        self.get_logger().info(f"segmentation_node listening on {INPUT_TOPIC}, publishing {OUTPUT_TOPIC}")

    def on_points(self, msg: String):
        data = schemas.parse(msg.data)
        raw_points = data["points"]

        if len(raw_points) == 0:
            labels, confidence = [], []
        else:
            points = np.asarray(raw_points, dtype=np.float32)
            raw_labels, raw_confidence = self._classify(points)
            labels = np.asarray(raw_labels, dtype=np.int64).tolist()
            confidence = np.asarray(raw_confidence, dtype=np.float32).tolist()

        out = String()
        # carrying `points` forward too — see schemas.make_segmentation_msg
        # docstring for why (lets GridEngine/Tracking consume this topic
        # alone instead of separately re-matching against points_preprocessed)
        out.data = schemas.make_segmentation_msg(
            labels, confidence,
            timestamp=data["timestamp"], frame_id=data["frame_id"],
            points=raw_points,
        )
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = SegmentationNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
