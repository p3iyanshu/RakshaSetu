"""
fusion_node -- interfaces.md SS7. The one node in this package that is
genuinely Member 4's own logic, not a wrapper around someone else's
function: reconciles Member 2's grid with Member 3's tracked objects by
computing which grid cell each object's position falls into.

Reuses grid_builder's own (underscore-prefixed, internal) range/angular-bin
helpers rather than re-deriving the same math here -- section 7 of
interfaces.md is explicit that this must use "the exact same range/angular
binning as GridEngine"; a second, independently-written implementation of
that binning is exactly how the two could silently drift apart.

Publishes the grid+objects shape from interfaces.md SS7's own wire example
(grid, objects, timestamp, frame_id) -- NOT shared/schemas.py's FusedFrame
dataclass, which additionally carries a `metrics` dict. That field isn't in
interfaces.md's documented JSON example and aggregate pipeline metrics
(fps/latency/mIoU/compute-savings) aren't naturally this node's own data to
produce -- flag to the team before assuming either this node or the
dashboard backend owns computing it, rather than fabricating placeholder
numbers here.
"""
import os
import sys

import numpy as np
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "grid_engine"))
from grid_builder import (  # noqa: E402
    RANGE_BIN_EDGES,
    _angular_bin_counts,
    _angular_bin_lookup,
    _range_bin_lookup,
)

from . import topics

# See grid_engine_node.py's MAX_PENDING_FRAMES comment -- same reasoning.
MAX_PENDING_FRAMES = 40
_N_ANGULAR_BINS = _angular_bin_counts(RANGE_BIN_EDGES)  # computed once -- depends only on the (fixed) range-bin edges


class FusionNode(Node):
    def __init__(self):
        super().__init__("fusion_node")
        self._pending_grid = {}  # timestamp -> grid payload, waiting for a matching tracking frame

        self.publisher = self.create_publisher(String, topics.TOPIC_FUSION, 10)
        self.grid_sub = self.create_subscription(String, topics.TOPIC_GRID, self._on_grid, 10)
        self.tracking_sub = self.create_subscription(
            String, topics.TOPIC_TRACKING, self._on_tracking, 10
        )

    def _on_grid(self, msg: String):
        payload = topics.decode(msg.data)
        self._pending_grid[payload["timestamp"]] = payload
        if len(self._pending_grid) > MAX_PENDING_FRAMES:
            oldest = next(iter(self._pending_grid))
            del self._pending_grid[oldest]

    def _on_tracking(self, msg: String):
        tracking = topics.decode(msg.data)
        grid_payload = self._pending_grid.pop(tracking["timestamp"], None)
        if grid_payload is None:
            self.get_logger().warn(
                f"fusion_node: no grid frame matching timestamp {tracking['timestamp']}, dropping"
            )
            return

        grid = dict(grid_payload["grid"])  # shallow copy -- about to add dynamic_track_id to some cells
        objects = tracking["objects"]

        if objects:
            xy = np.array([[obj["position"][0], obj["position"][1]] for obj in objects])
            r = np.linalg.norm(xy, axis=1)
            theta = np.arctan2(xy[:, 1], xy[:, 0])
            range_bin, valid = _range_bin_lookup(r, RANGE_BIN_EDGES)
            angular_bin = _angular_bin_lookup(theta, range_bin, _N_ANGULAR_BINS)

            for obj, rb, ab, is_valid in zip(objects, range_bin, angular_bin, valid):
                if not is_valid:
                    continue  # object beyond the grid's outer edge -- no cell to map it onto, same as GridEngine's own clipping
                obj["grid_range_bin"] = int(rb)
                obj["grid_angular_bin"] = int(ab)
                key = f"{int(rb)}_{int(ab)}"
                if key in grid:
                    grid[key] = {**grid[key], "dynamic_track_id": obj["track_id"]}

        out = String()
        out.data = topics.encode({
            "grid": grid,
            "objects": objects,
            "timestamp": tracking["timestamp"],
            "frame_id": tracking["frame_id"],
        })
        self.publisher.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = FusionNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
