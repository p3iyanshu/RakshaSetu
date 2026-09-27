"""
ego_odometry_node -- interfaces.md SS3.

Real CARLA feed (Task 3, team_tasks/04_systems_integration_ros2.md): this
node subscribes to carla-ros-bridge's `/carla/<role_name>/odometry` topic
(a nav_msgs/Odometry, from carla_ros_bridge/odom_sensor.py's
sensor.pseudo.odom) and republishes its twist (the ego vehicle's own
linear/angular velocity) in this package's JSON wire schema.

Unlike lidar_ingest_node, no rate-limiting timer here -- an Odometry
message is a handful of floats, not a ~60k-point array, so JSON-encoding it
is cheap regardless of how often the bridge publishes it. Republished
directly on receipt so tracking_node always has the freshest available
ego-motion estimate (it only ever reads "whatever's latest" -- see that
node's docstring -- so publishing faster than it consumes costs nothing).

Supersedes the near-zero stub this node published before the bridge was
wired in -- tracking_node's ego-motion compensation (interfaces.md SS6) was
built and tested against that stub already, and is unaffected by this swap:
it only ever depends on TOPIC_EGO_ODOMETRY's schema, not where the numbers
come from.
"""
import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String

from . import topics

CARLA_ODOMETRY_TOPIC = "/carla/ego_vehicle/odometry"


class EgoOdometryNode(Node):
    def __init__(self):
        super().__init__("ego_odometry_node")
        self.publisher = self.create_publisher(String, topics.TOPIC_EGO_ODOMETRY, 10)
        self.subscription = self.create_subscription(
            Odometry, CARLA_ODOMETRY_TOPIC, self._on_carla_odometry, 10
        )
        self.get_logger().info(
            f"ego_odometry_node: subscribed to {CARLA_ODOMETRY_TOPIC}, "
            f"republishing on {topics.TOPIC_EGO_ODOMETRY}"
        )

    def _on_carla_odometry(self, msg: Odometry):
        linear = msg.twist.twist.linear
        angular = msg.twist.twist.angular

        out = String()
        out.data = topics.encode({
            "linear_velocity": (linear.x, linear.y, linear.z),
            "angular_velocity": (angular.x, angular.y, angular.z),
            "timestamp": f"{msg.header.stamp.sec}.{msg.header.stamp.nanosec:09d}",
            "frame_id": topics.EGO_LIDAR_FRAME,
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = EgoOdometryNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
