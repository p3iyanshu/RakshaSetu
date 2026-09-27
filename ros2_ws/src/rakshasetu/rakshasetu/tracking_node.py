"""
tracking_node.py

Thin wrapper around Member 3's real clustering + tracking
(tracking/clustering.py, tracking/kalman_tracker.py).

Ego-motion compensation is NOT done in this node, unlike an earlier stub
version of this file. The real tracking/kalman_tracker.MultiObjectTracker
already takes `ego_velocity` in `.update()` and returns the compensated
`velocity` directly per object (v2, per interfaces.md SS6) -- see
HANDOVER_TO_MEMBER4.md SS4. Calling schemas.compensate_velocity() on top of
that here would ADD the ego velocity a second time (double-compensation),
so that step is gone entirely from this file; the tracker's own output is
passed straight through.

`MultiObjectTracker` is constructed ONCE and kept alive across frames — it
holds per-track Kalman filter state, it is not a pure function you can call
fresh each callback. Its `dt` (frame interval) is baked into each track's
motion model at construction time and can't vary per update
(kalman_tracker.py), so this node measures a real dt from the first two
received frames' own timestamps before constructing it, per
HANDOVER_TO_MEMBER4.md's "use real elapsed time between frames from your
node's timestamps, not a hardcoded value" -- rather than guessing a fixed
rate up front.
"""

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from rakshasetu import schemas
from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES
from kalman_tracker import MultiObjectTracker

SEGMENTATION_TOPIC = "/rakshasetu/segmentation/labels"
EGO_ODOMETRY_TOPIC = "/rakshasetu/ego/odometry"
OUTPUT_TOPIC = "/rakshasetu/tracking/objects"


class TrackingNode(Node):
    def __init__(self):
        super().__init__("tracking_node")
        self.segmentation_sub = self.create_subscription(
            String, SEGMENTATION_TOPIC, self.on_segmentation, 10
        )
        self.odometry_sub = self.create_subscription(
            String, EGO_ODOMETRY_TOPIC, self.on_odometry, 10
        )
        self.publisher = self.create_publisher(String, OUTPUT_TOPIC, 10)

        self.tracker = None          # constructed lazily -- see on_segmentation()
        self._prev_timestamp = None  # used only to measure a real dt for construction
        self.latest_ego_linear_velocity = [0.0, 0.0, 0.0]

        self.get_logger().info(
            f"tracking_node listening on {SEGMENTATION_TOPIC} and {EGO_ODOMETRY_TOPIC}, "
            f"publishing {OUTPUT_TOPIC}"
        )

    def on_odometry(self, msg: String):
        data = schemas.parse(msg.data)
        self.latest_ego_linear_velocity = data["linear_velocity"]

    def on_segmentation(self, msg: String):
        data = schemas.parse(msg.data)
        if "points" not in data:
            self.get_logger().warn("segmentation message has no points field, skipping this frame")
            return

        timestamp = data["timestamp"]
        if self.tracker is None:
            if self._prev_timestamp is None:
                # first frame ever -- no prior timestamp to measure a real
                # dt from yet, so there's nothing to construct the tracker
                # with. Skip publishing for just this one frame.
                self._prev_timestamp = timestamp
                return
            dt = max(timestamp - self._prev_timestamp, 1e-3)
            self.tracker = MultiObjectTracker(dt=dt)
            self.get_logger().info(f"tracking_node: constructed MultiObjectTracker with measured dt={dt:.4f}s")
        self._prev_timestamp = timestamp

        points = np.asarray(data["points"], dtype=np.float64)
        labels = np.asarray(data["labels"], dtype=np.int64)
        confidence = np.asarray(data["confidence"], dtype=np.float32)

        obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)  # wall/pole/vehicle/pedestrian only
        xyz = points[obstacle_mask, :3]
        obs_labels = labels[obstacle_mask]
        obs_confidence = confidence[obstacle_mask]

        cluster_ids = cluster_obstacles(xyz, obs_labels)
        clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)

        ego_velocity_2d = (self.latest_ego_linear_velocity[0], self.latest_ego_linear_velocity[1])
        # Always run .update(), even with zero clusters this frame -- this
        # is what predicts/ages every existing track forward one real
        # frame. Skipping it on an empty frame would desync track age from
        # actual elapsed frames.
        tracked = self.tracker.update(clusters, ego_velocity=ego_velocity_2d)

        objects = [
            {
                "track_id": obj["track_id"],
                "class": obj["cls"],
                "position": list(obj["position"]),
                "velocity": list(obj["velocity"]),               # ego-motion-compensated, from the tracker itself
                "velocity_relative": list(obj["velocity_relative"]),
                "is_dynamic": obj["is_dynamic"],
                "confidence": obj["confidence"],
            }
            for obj in tracked
        ]

        out = String()
        out.data = schemas.make_tracking_msg(
            objects, timestamp=data["timestamp"], frame_id=data["frame_id"]
        )
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = TrackingNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
