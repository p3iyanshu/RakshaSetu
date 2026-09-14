"""
preprocessing_node.py

Subscribes to raw LiDAR points, applies ground filtering + downsampling,
republishes on a "preprocessed" topic. Segmentation and Tracking consume
this topic, not the raw one — per interfaces.md, Segmentation runs on
"post-preprocessing" points.

Not one of Members 1-3's three delivered modules (ownership was never
explicitly assigned, per HANDOVER_TO_MEMBER4.md) -- stays a naive stub for
today's demo. Real point counts now come from the replayed mock-scene
frames (lidar_ingest_node.py) rather than random noise, so this filter
runs on realistic geometry even though the filter logic itself is still a
placeholder.

>>> SWAP FOR REAL DATA LATER <<<
Replace `ground_filter()` and `downsample()` with a real implementation
(RANSAC ground-plane fit, voxel-grid downsampling) if there's time before
the demo. The node wiring below doesn't need to change.
"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas

INPUT_TOPIC = "/rakshasetu/lidar/points"
OUTPUT_TOPIC = "/rakshasetu/lidar/points_preprocessed"

GROUND_Z_THRESHOLD = -1.5  # naive stand-in for real ground-plane filtering
DOWNSAMPLE_KEEP_RATIO = 1.0  # 1.0 = no downsampling yet; lower once real data arrives


def ground_filter(points):
    """
    STUB: naive height-threshold filter, NOT a real ground-plane fit.
    Replace with RANSAC plane fitting or similar before trusting this for
    anything beyond "does the pipeline run end to end."
    """
    return [p for p in points if p[2] > GROUND_Z_THRESHOLD]


def downsample(points, keep_ratio=DOWNSAMPLE_KEEP_RATIO):
    """STUB: uniform random keep-ratio downsampling. Swap for voxel-grid
    downsampling (e.g. via Open3D) once real point density matters."""
    if keep_ratio >= 1.0:
        return points
    step = max(1, int(1 / keep_ratio))
    return points[::step]


class PreprocessingNode(Node):
    def __init__(self):
        super().__init__("preprocessing_node")
        self.subscription = self.create_subscription(String, INPUT_TOPIC, self.on_points, 10)
        self.publisher = self.create_publisher(String, OUTPUT_TOPIC, 10)
        self.get_logger().info(f"preprocessing_node listening on {INPUT_TOPIC}, publishing {OUTPUT_TOPIC}")

    def on_points(self, msg: String):
        data = schemas.parse(msg.data)
        points = data["points"]

        filtered = ground_filter(points)
        downsampled = downsample(filtered)

        out = String()
        out.data = schemas.make_lidar_points_msg(
            downsampled, timestamp=data["timestamp"], frame_id=data["frame_id"]
        )
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = PreprocessingNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
