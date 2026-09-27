"""
lidar_ingest_node -- interfaces.md SS1.

Publishes raw points (N,4) x,y,z,intensity on TOPIC_LIDAR_RAW.

Real CARLA feed (Task 3, team_tasks/04_systems_integration_ros2.md): this
node subscribes to carla-ros-bridge's own `/carla/<role_name>/lidar` topic
(a sensor_msgs/PointCloud2, published by carla_ros_bridge/lidar.py) and
republishes it in this package's JSON wire schema. carla_ros_bridge's lidar
sensor already publishes exactly x,y,z,intensity as consecutive float32s,
16 bytes/point (see that module's `fields` list) and already flips the y
axis to ROS's right-handed convention -- no transform needed here, just a
raw byte reinterpretation matching that same layout.

Decouples from the bridge's own publish rate (measured ~35-40Hz, tied to
CARLA's simulation tick rate) by caching only the LATEST received frame and
republishing on our own PUBLISH_RATE_HZ timer -- passing every incoming
frame straight through would recreate the JSON-serialization bottleneck
already discovered and fixed once before (see PUBLISH_RATE_HZ's comment
below); that finding is about our own JSON transport, not the bridge, so it
applies here just the same.

Supersedes the mock_data.py replay this node used before the bridge was
wired in -- everything downstream is unaffected either way, since it only
ever depends on this node's own output topic.
"""
import numpy as np
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import PointCloud2
from std_msgs.msg import String

from . import topics

CARLA_LIDAR_TOPIC = "/carla/ego_vehicle/lidar"

# See topics.py's module docstring: JSON-encoding one raw ~60k-point frame
# costs ~0.2-0.3s per hop, multiplied across every hop in the pipeline.
# Passing the bridge's native ~35-40Hz stream straight through reproduces
# the exact 100%-drop-rate bug already found and fixed with the mock feed --
# 2Hz gives the JSON-over-String pipeline enough wall-clock time per frame
# to actually finish.
PUBLISH_RATE_HZ = 2.0


class LidarIngestNode(Node):
    def __init__(self):
        super().__init__("lidar_ingest_node")
        self.publisher = self.create_publisher(String, topics.TOPIC_LIDAR_RAW, 10)
        self._latest = None  # (points_ndarray, stamp_str) from the most recent bridge message

        self.subscription = self.create_subscription(
            PointCloud2, CARLA_LIDAR_TOPIC, self._on_carla_lidar, 10
        )
        self.timer = self.create_timer(1.0 / PUBLISH_RATE_HZ, self._tick)
        self.get_logger().info(
            f"lidar_ingest_node: subscribed to {CARLA_LIDAR_TOPIC}, "
            f"republishing on {topics.TOPIC_LIDAR_RAW} at {PUBLISH_RATE_HZ} Hz"
        )

    def _on_carla_lidar(self, msg: PointCloud2):
        points = np.frombuffer(bytes(msg.data), dtype=np.float32).reshape(-1, 4)
        stamp = f"{msg.header.stamp.sec}.{msg.header.stamp.nanosec:09d}"
        self._latest = (points, stamp)

    def _tick(self):
        if self._latest is None:
            return
        points, stamp = self._latest

        msg = String()
        msg.data = topics.encode({
            "points": points,
            "timestamp": stamp,
            "frame_id": topics.EGO_LIDAR_FRAME,
        })
        self.publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = LidarIngestNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
