"""
ego_odometry_node.py

Publishes the ego vehicle's own motion, which Tracking needs to correctly
compute whether a detected object is actually moving in the real world vs.
only appearing to move because the vehicle observing it is moving.

>>> SWAP FOR REAL DATA LATER <<<
Once carla-ros-bridge is wired in, replace this stub with a subscription to
CARLA's real vehicle odometry topic (typically something like
/carla/ego_vehicle/odometry) and republish it here in our schema — keeping
our internal topic name/shape stable regardless of what the CARLA bridge
happens to call its own topic. Not in scope for today's demo: the shared
mock scene (shared/mock_data.py) that lidar_ingest_node.py now replays was
generated in a fixed world frame with the "ego vehicle" implicitly
stationary, so near-zero odometry is the physically-correct value for it,
not just a placeholder -- see tracking_node.py's docstring for how this
flows into ego-motion compensation.
"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas

TOPIC = "/rakshasetu/ego/odometry"
PUBLISH_HZ = 10.0  # odometry is usually published faster than the LiDAR frame rate


class EgoOdometryNode(Node):
    def __init__(self):
        super().__init__("ego_odometry_node")
        self.publisher = self.create_publisher(String, TOPIC, 10)
        self.timer = self.create_timer(1.0 / PUBLISH_HZ, self.publish_odometry)
        self.get_logger().info(
            f"ego_odometry_node started (STUB — near-zero values until CARLA is wired in), "
            f"publishing on {TOPIC} at {PUBLISH_HZ} Hz"
        )

    def publish_odometry(self):
        # STUB: near-zero motion. Real values come from CARLA once the
        # bridge is live — see module docstring.
        msg = String()
        msg.data = schemas.make_ego_odometry_msg(
            linear_velocity=[0.0, 0.0, 0.0],
            angular_velocity=[0.0, 0.0, 0.0],
        )
        self.publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = EgoOdometryNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
