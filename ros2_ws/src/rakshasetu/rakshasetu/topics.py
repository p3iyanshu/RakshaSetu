"""
Topic names and the JSON wire-encoding helpers every node in this package
shares. Mirrors ros2_ws/interfaces.md exactly -- if you change a topic name
or a field here, update interfaces.md (and tell the team, per its own "what
to do if your module doesn't naturally fit this shape" section) rather than
letting this drift.

Wire format: every message on every topic below is a std_msgs/String whose
`data` is the JSON object documented in interfaces.md for that topic --
not a custom .msg type. Chosen deliberately for Week 1: it keeps this a
plain ament_python package (no rosidl/.msg code generation, no C++
toolchain needed just to change a field), and every payload already has to
match the documented JSON shape anyway (dashboard consumes fused output as
JSON over WebSocket regardless). Revisit as a v3 interfaces.md conversation
if per-frame latency from JSON (de)serialization of the raw point arrays
ever shows up as the bottleneck -- it's the one place this shortcut could
bite.
"""
import json

import numpy as np

TOPIC_LIDAR_RAW = "/rakshasetu/lidar/points"
TOPIC_LIDAR_PREPROCESSED = "/rakshasetu/lidar/points_preprocessed"
TOPIC_EGO_ODOMETRY = "/rakshasetu/ego/odometry"
TOPIC_SEGMENTATION = "/rakshasetu/segmentation/labels"
TOPIC_GRID = "/rakshasetu/grid/occupancy"
TOPIC_TRACKING = "/rakshasetu/tracking/objects"
TOPIC_FUSION = "/rakshasetu/fusion/output"

EGO_LIDAR_FRAME = "ego_lidar"


class _NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        return super().default(obj)


def encode(payload: dict) -> str:
    """dict -> JSON string, ready to drop into a std_msgs/String.data field."""
    return json.dumps(payload, cls=_NumpyEncoder)


def decode(data: str) -> dict:
    """std_msgs/String.data -> dict."""
    return json.loads(data)


def stamp_now(node) -> str:
    """ROS 2 Time as the 'seconds.nanoseconds' string interfaces.md uses in
    its examples, from a node's own clock."""
    t = node.get_clock().now().seconds_nanoseconds()
    return f"{t[0]}.{t[1]:09d}"
