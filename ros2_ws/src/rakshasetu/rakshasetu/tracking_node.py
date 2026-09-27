"""
tracking_node -- interfaces.md SS6. Thin wrapper around Member 3's
cluster_obstacles() + extract_cluster_features() (tracking/clustering.py)
and MultiObjectTracker (tracking/kalman_tracker.py) -- no clustering or
tracking logic lives here.

Consumes segmented points (points + labels + confidence, matched by
timestamp -- same approach as grid_engine_node, see its docstring) and
TOPIC_EGO_ODOMETRY. Ego odometry is applied as "whatever the latest received
value is" rather than matched to the same exact timestamp as the LiDAR
frame: it publishes independently and changes slowly relative to LiDAR's
frame rate, so nearest-latest is an acceptable Week 1 simplification --
revisit if the CARLA bridge ever produces odometry choppy enough for that
to matter.

One tracker instance persists for the node's lifetime, since track_id
continuity across frames is the entire point of tracking (interfaces.md's
"critical rule" for this section) -- a fresh tracker per message would
issue a new ID every frame and silently break everything downstream that
depends on stable IDs (velocity-over-time, trajectory, dashboard motion
trails).
"""
import os
import sys

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

_TRACKING_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "tracking")
sys.path.insert(0, _TRACKING_DIR)
from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES  # noqa: E402
from kalman_tracker import MultiObjectTracker  # noqa: E402

from . import topics

# See grid_engine_node.py's MAX_PENDING_FRAMES comment -- same reasoning.
MAX_PENDING_FRAMES = 40


class TrackingNode(Node):
    def __init__(self):
        super().__init__("tracking_node")
        self._pending_points = {}  # timestamp -> points payload, waiting for a matching segmentation frame
        self._ego_velocity = (0.0, 0.0)  # latest (vx, vy) from TOPIC_EGO_ODOMETRY; near-zero until the CARLA bridge is live
        self.tracker = MultiObjectTracker()

        self.publisher = self.create_publisher(String, topics.TOPIC_TRACKING, 10)
        self.points_sub = self.create_subscription(
            String, topics.TOPIC_LIDAR_PREPROCESSED, self._on_points, 10
        )
        self.segmentation_sub = self.create_subscription(
            String, topics.TOPIC_SEGMENTATION, self._on_segmentation, 10
        )
        self.odometry_sub = self.create_subscription(
            String, topics.TOPIC_EGO_ODOMETRY, self._on_odometry, 10
        )

    def _on_points(self, msg: String):
        payload = topics.decode(msg.data)
        self._pending_points[payload["timestamp"]] = payload
        if len(self._pending_points) > MAX_PENDING_FRAMES:
            oldest = next(iter(self._pending_points))
            del self._pending_points[oldest]

    def _on_odometry(self, msg: String):
        payload = topics.decode(msg.data)
        vx, vy, _vz = payload["linear_velocity"]
        self._ego_velocity = (vx, vy)

    def _on_segmentation(self, msg: String):
        seg = topics.decode(msg.data)
        points_payload = self._pending_points.pop(seg["timestamp"], None)
        if points_payload is None:
            self.get_logger().warn(
                f"tracking_node: no preprocessed-points frame matching timestamp {seg['timestamp']}, dropping"
            )
            return

        points = np.asarray(points_payload["points"], dtype=np.float32)
        labels = np.asarray(seg["labels"])
        confidence = np.asarray(seg["confidence"], dtype=np.float32)

        obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)
        xyz_obs = points[obstacle_mask, :3]
        labels_obs = labels[obstacle_mask]
        confidence_obs = confidence[obstacle_mask]

        cluster_ids = cluster_obstacles(xyz_obs, labels_obs)
        clusters = extract_cluster_features(xyz_obs, labels_obs, confidence_obs, cluster_ids)
        objects = self.tracker.update(clusters, ego_velocity=self._ego_velocity)

        wire_objects = []
        for obj in objects:
            wire_objects.append({
                "track_id": obj["track_id"],
                "class": obj["cls"],  # to_tracked_object() uses "cls" internally; wire contract calls it "class"
                "position": obj["position"],
                "velocity": obj["velocity"],
                "velocity_relative": obj["velocity_relative"],
                "is_dynamic": obj["is_dynamic"],
                "confidence": obj["confidence"],
            })

        out = String()
        out.data = topics.encode({
            "objects": wire_objects,
            "timestamp": seg["timestamp"],
            "frame_id": seg["frame_id"],
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = TrackingNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
