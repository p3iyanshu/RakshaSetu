"""
schemas.py

Single source of truth for message payload shapes, matching interfaces.md
exactly. Every node imports from here instead of building dicts by hand, so
the contract lives in ONE place — if the contract changes, you change it
here and every node picks up the change automatically instead of drifting
out of sync with each other.

We're encoding every message as a JSON string inside a plain std_msgs/String,
NOT as real custom ROS 2 .msg types. This is a deliberate simplification:
custom .msg files need a separate CMake-based interface package and a full
colcon build/generation step, which is a lot of ROS 2 packaging machinery to
learn in week 1. JSON-over-String gets you a running, swappable pipeline
today. Upgrading to real .msg types later (see msg/README.md) is a
mechanical change, not a redesign — the field names and shapes stay
identical.
"""

import json
import time

# Class ID mapping — locked, matches interfaces.md exactly.
# If this changes, it must change in interfaces.md too, and everyone
# needs to know.
CLASS_MAP = {
    0: "drivable_terrain",
    1: "static_obstacle_wall",
    2: "static_obstacle_pole",
    3: "dynamic_vehicle",
    4: "dynamic_pedestrian",
    5: "other_unknown",
}

FRAME_ID = "ego_lidar"

# Member 2's real benchmarked numbers (grid_engine/README.md,
# HANDOVER_TO_MEMBER4.md SS3) — offline-measured, not recomputed live per
# frame (see make_fusion_msg's docstring), but real, validated figures
# rather than placeholders.
SEGMENTATION_MIOU = 0.868  # sequence 08, held out (Member1_HANDOVER_REPORT.md)
GRID_COMPUTE_SAVINGS_PCT = 61.5  # vs. a uniform 5cm-everywhere grid, 20-frame shared mock sequence


def now_ts() -> float:
    """Unix timestamp as float seconds. Good enough for a JSON-over-String
    stub; real ROS 2 Time (sec + nanosec) matters more once you're using
    actual message_filters synchronization in Week 2."""
    return time.time()


# ---------------------------------------------------------------------------
# 1. LidarIngest
# ---------------------------------------------------------------------------
def make_lidar_points_msg(points, timestamp=None, frame_id=FRAME_ID) -> str:
    """
    points: list of [x, y, z, intensity], length N (N varies per frame)
    """
    payload = {
        "points": points,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
    }
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# 2. Segmentation (Member 1)
# ---------------------------------------------------------------------------
def make_segmentation_msg(labels, confidence, timestamp=None, frame_id=FRAME_ID,
                           points=None) -> str:
    """
    labels: list[int], length N — one class ID per point (see CLASS_MAP)
    confidence: list[float], length N, same order as labels

    NOTE: interfaces.md's Segmentation schema is labels + confidence only.
    We optionally carry `points` along in this stub payload too, so
    GridEngine/Tracking can consume "segmented points" directly without a
    separate timestamp-matching step against the raw LidarIngest topic.
    This is a practical addition on top of the locked contract, not a
    change to it — if Member 1's real node doesn't want to do this, that's
    fine, GridEngine/Tracking fall back to caching the latest LidarIngest
    message by timestamp instead (see grid_engine_node.py).
    """
    payload = {
        "labels": labels,
        "confidence": confidence,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
    }
    if points is not None:
        payload["points"] = points
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# 3. GridEngine (Member 2)
# ---------------------------------------------------------------------------
def make_grid_msg(grid: dict, timestamp=None, frame_id=FRAME_ID) -> str:
    """
    grid: dict keyed by "range_angularbin" string (e.g. "2_88") -> {
        "class": int, "height_max": float, "height_mean": float,
        "point_count": int, "confidence": float, "height_variance": float
    }

    interfaces.md v2: the key is (range_bin, angular_bin) -- range_bin is a
    RADIAL DISTANCE band from the ego vehicle (sqrt(x^2+y^2)), NOT a LiDAR
    vertical channel (that was a v1 bug, now fixed). angular_bin is the
    horizontal azimuth bucket. GridEngine's own build_adaptive_grid()
    (grid_engine/grid_builder.py) computes this internally, using the same
    convention position_to_range_angular_bin() below delegates to for
    Fusion -- GridEngine and Fusion must agree on exactly the same
    conversion for the fusion cross-referencing (v2 fix #3) to work.

    `height_variance` is Member 2's addition beyond interfaces.md's
    original five locked fields (grid_engine/grid_builder.py's docstring,
    HANDOVER_TO_MEMBER4.md SS3) -- kept on the wire here since it's purely
    additive (a consumer that doesn't know about it can just ignore it).

    NOTE: JSON object keys must be strings, so the (range_bin, angular_bin)
    tuple is encoded here as "range_angularbin", e.g. (2, 88) becomes
    "2_88". Use grid_key()/parse_grid_key() below instead of formatting
    this by hand so it stays consistent everywhere.
    """
    payload = {
        "grid": grid,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
    }
    return json.dumps(payload)


def grid_key(range_bin: int, angular_bin: int) -> str:
    return f"{range_bin}_{angular_bin}"


def parse_grid_key(key: str):
    range_bin, angular_bin = key.split("_")
    return int(range_bin), int(angular_bin)


def position_to_range_angular_bin(x: float, y: float):
    """
    THE single conversion function from a (x, y) ground-plane position to
    (range_bin, angular_bin) -- used by BOTH GridEngine (via
    build_adaptive_grid()'s own internal binning) and Fusion (this
    wrapper) to map tracked objects onto that same grid. Delegates to
    grid_engine.grid_builder.position_to_bin -- Member 2's real adaptive
    band table (grid_builder.RANGE_BIN_EDGES: 8 bands, 5cm cells out to
    10m, coarsening to 50cm at 100m) -- rather than reimplementing the
    range/angular math here, which is exactly the kind of drift
    interfaces.md v2 fix #3 exists to prevent (see that file's "Corrected
    in v2" note on GridEngine's section). Lazy import: `rakshasetu`'s
    __init__.py (repo_integration) must have already put grid_engine/ on
    sys.path, which is guaranteed by the time this module itself is
    importable as a submodule of the rakshasetu package.
    """
    from grid_builder import position_to_bin
    return position_to_bin(x, y)


# ---------------------------------------------------------------------------
# 3b. EgoOdometry
# ---------------------------------------------------------------------------
def make_ego_odometry_msg(linear_velocity, angular_velocity,
                           timestamp=None, frame_id=FRAME_ID) -> str:
    """
    linear_velocity: [vx, vy, vz], ego vehicle's own velocity, m/s
    angular_velocity: [wx, wy, wz], ego vehicle's own angular velocity, rad/s

    Consumed by Tracking to ego-motion-compensate object velocities
    (interfaces.md v2 fix #4). Until CARLA is wired in, this stub publishes
    near-zero values.
    """
    payload = {
        "linear_velocity": linear_velocity,
        "angular_velocity": angular_velocity,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
    }
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# 4. Tracking (Member 3)
# ---------------------------------------------------------------------------
def make_tracking_msg(objects: list, timestamp=None, frame_id=FRAME_ID) -> str:
    """
    objects: list of {
        "track_id": int, "class": int,
        "position": [x, y, z],
        "velocity": [vx, vy, vz],            # ego-motion-COMPENSATED (real-world) velocity
        "velocity_relative": [vx, vy, vz],   # raw, uncompensated, ego-frame velocity
        "is_dynamic": bool,                  # derived from `velocity`, not `velocity_relative`
        "confidence": float
    }

    interfaces.md v2 fix #4: `velocity` must have the ego vehicle's own
    motion subtracted out (see EgoOdometry above), or stationary objects
    will appear to be moving whenever the ego vehicle itself is in motion.
    `velocity_relative` is kept alongside it for debugging only.

    tracking/kalman_tracker.py's MultiObjectTracker.update() now does this
    compensation itself (it takes ego_velocity directly) -- tracking_node.py
    passes its objects straight through here, it does not recompute
    compensation on top of them.
    """
    payload = {
        "objects": objects,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
    }
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# 5. Fusion (mine)
# ---------------------------------------------------------------------------
def make_fusion_msg(grid: dict, objects: list, timestamp=None, frame_id=FRAME_ID,
                     metrics: dict = None) -> str:
    """
    interfaces.md v2 fix #3: this is a real reconciliation, not a blind
    pass-through. By the time this is called, `objects` should already have
    grid_range_bin/grid_angular_bin added per object, and `grid` should
    already have dynamic_track_id added onto any cell an object maps to.
    See fusion_node.py's reconcile() for where that reconciliation actually
    happens -- this function just serializes whatever it's handed.

    metrics: shared/schemas.py's FusedFrame.metrics --
    {"fps": float, "latency_ms": float, "miou": float, "compute_savings_pct": float}.
    fps/latency_ms are computed live in fusion_node.py from real wall-clock
    timing (rolling publish rate, and elapsed time since the frame's own
    LidarIngest timestamp). miou/compute_savings_pct are NOT live-computable
    inside the running pipeline -- there's no ground truth at inference time
    to score mIoU against, and compute_savings_pct is inherently a
    whole-benchmark-run comparison against a uniform-grid baseline, not a
    per-frame stat -- so those two are Member 1's/Member 2's real,
    offline-validated numbers (SEGMENTATION_MIOU / GRID_COMPUTE_SAVINGS_PCT
    above), not fabricated placeholders.
    """
    payload = {
        "grid": grid,
        "objects": objects,
        "timestamp": timestamp if timestamp is not None else now_ts(),
        "frame_id": frame_id,
        "metrics": metrics if metrics is not None else {},
    }
    return json.dumps(payload)


def compensate_velocity(raw_velocity, ego_linear_velocity):
    """
    interfaces.md v2 fix #4. Converts a raw, directly-observed object
    velocity (as measured in the moving ego frame) into the object's
    real-world velocity.

    THE FORMULA, spelled out because the sign here is easy to get backwards:
    by definition, relative velocity = object_world_velocity - ego_world_velocity
    (that's why a stationary object appears to move backward when your own
    vehicle moves forward). To recover object_world_velocity, you therefore
    ADD the ego velocity back:
        object_world_velocity = velocity_relative + ego_world_velocity

    NOTE: tracking_node.py does NOT call this anymore -- the real
    tracking/kalman_tracker.py's MultiObjectTracker.update() already does
    this exact compensation internally (it takes ego_velocity and returns
    the compensated `velocity` directly per object). This function is kept
    here as the documented reference for the formula, and for any future
    caller that receives raw, uncompensated velocities from somewhere else.
    Calling it again on an already-compensated velocity would double-count
    the ego velocity.
    """
    return [
        raw_velocity[0] + ego_linear_velocity[0],
        raw_velocity[1] + ego_linear_velocity[1],
        raw_velocity[2] + ego_linear_velocity[2],
    ]


def parse(msg_data: str) -> dict:
    """Every node uses this to decode an incoming std_msgs/String .data field."""
    return json.loads(msg_data)
