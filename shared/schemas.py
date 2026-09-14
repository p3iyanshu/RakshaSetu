"""
The single source of truth for data shapes passed between modules.
See team_tasks/00_interfaces_and_handoff.md for the full handoff process,
and ros2_ws/interfaces.md (Member 4, v2) for the full ROS 2 topic-level
contract this file mirrors on the Python side.

Import from here -- never redefine these shapes locally.
"""
from dataclasses import dataclass

# Class labels used everywhere downstream of segmentation.
#
# v2 (2026-09-12): supersedes the original 4-class scheme, per Member 4's
# ros2_ws/interfaces.md v2 SS4. Splits static_obstacle into wall/pole and
# dynamic_object into vehicle/pedestrian, and adds an explicit
# "other/unknown" class for real objects that don't cleanly fit those
# buckets (previously such points were force-fit into static_obstacle, or
# dropped as IGNORE). Member 1 owns the raw-to-simplified remapping
# (data/class_mapping.py); everyone else only ever sees these 6 values
# (plus IGNORE, which is training-only -- see below).
DRIVABLE = 0
STATIC_OBSTACLE_WALL = 1
STATIC_OBSTACLE_POLE = 2
DYNAMIC_VEHICLE = 3
DYNAMIC_PEDESTRIAN = 4
OTHER_UNKNOWN = 5
IGNORE = 255   # training-time-only sentinel (excluded from loss/metrics via
               # ignore_index=IGNORE). classify() must never emit this at
               # inference -- every real point gets one of the 6 classes
               # above, even a low-confidence one gets OTHER_UNKNOWN, not IGNORE.

# ---- Stage 1: Raw ingest (LidarIngest -- interfaces.md SS1) ----
# points: np.ndarray, shape (N, 4) -> columns: x, y, z, intensity

# ---- Stage 2: Segmentation output (Member 1 -> Members 2, 3 -- interfaces.md SS4) ----
@dataclass
class SegmentationOutput:
    labels: "np.ndarray"        # shape (N,), values in {0,1,2,3,4,5} at inference
    confidence: "np.ndarray"    # shape (N,), float in [0.0, 1.0]

# ---- Stage 3: Grid Engine output (Member 2 -> Member 4 -- interfaces.md SS5) ----
# v2 correction: the grid is indexed by ground-plane position (range_bin,
# angular_bin), NOT LiDAR vertical channel -- v1 of interfaces.md had this
# wrong; a grid cell represents a location on the ground, aggregating points
# from any vertical channel that land there. On the wire (ROS2/JSON) the key
# is the STRING "{range_bin}_{angular_bin}"; shown here as a Python tuple key
# for convenience -- Member 4's node wrapper converts to the string form
# before publishing.
@dataclass
class GridCell:
    range_bin: int                # radial distance band index from the ego vehicle (NOT vertical LiDAR channel)
    angular_bin: int               # discretized azimuth (atan2(y, x)) around the vehicle
    cls: int                       # dominant class in this cell, same 6-class mapping as Segmentation
    height_max: float
    height_mean: float
    point_count: int
    confidence: float
    dynamic_track_id: int = None   # v2: set only by Fusion (Stage 5) for cells a tracked object currently occupies; absent otherwise (same sparse convention as the rest of the grid)

# Full grid = dict[(range_bin, angular_bin), GridCell] in Python;
# dict[str, GridCell-shaped dict], keyed by "{range_bin}_{angular_bin}", on the wire.

# ---- Stage 4: Tracking output (Member 3 -> Member 4 -- interfaces.md SS6) ----
# v2 addition: ego-motion compensation. Tracking now needs the ego vehicle's
# own motion to tell "this object is really moving" apart from "this object
# only looks like it's moving because the vehicle observing it is moving."
@dataclass
class EgoOdometry:
    linear_velocity: tuple     # (vx, vy, vz), ego frame, m/s -- the ego vehicle's OWN velocity
    angular_velocity: tuple    # (wx, wy, wz), rad/s

@dataclass
class TrackedObject:
    track_id: int                  # stable across frames for the same physical object -- this is what makes it tracking, not per-frame detection
    cls: int                       # same 6-class mapping as Segmentation (typically 1-5)
    position: tuple                 # (x, y, z), ego frame
    velocity: tuple                  # (vx, vy, vz) -- EGO-MOTION-COMPENSATED. is_dynamic must be derived from THIS field, and downstream consumers should treat this as "true" velocity.
    velocity_relative: tuple          # (vx, vy, vz) -- RAW apparent velocity, before compensation. Debugging/visualization only -- never use for is_dynamic or any decision logic; looks large for a stationary object whenever the ego vehicle is moving.
    is_dynamic: bool                   # derived from `velocity` (compensated), never `velocity_relative`
    confidence: float
    grid_range_bin: int = None          # v2: set only by Fusion (Stage 5) -- which grid cell this object's position falls into
    grid_angular_bin: int = None        # v2: set only by Fusion (Stage 5)

# ---- Stage 5: Fusion output (Member 4 -> Member 5's dashboard -- interfaces.md SS7) ----
# v2 correction: Fusion now performs real reconciliation, not just
# packaging -- it maps each tracked object onto its grid cell (populating
# grid_range_bin/grid_angular_bin on the object, and dynamic_track_id on the
# cell) instead of emitting grid and objects as two unlinked lists.
@dataclass
class FusedFrame:
    timestamp: float
    grid: list                  # list[GridCell]; cells with an object mapped onto them carry dynamic_track_id
    objects: list                # list[TrackedObject]; each carries grid_range_bin/grid_angular_bin
    metrics: dict                 # {"fps": float, "latency_ms": float, "miou": float, "compute_savings_pct": float}

# Radial resolution bands: fine near the vehicle, coarse far away. Finalized
# by Member 2 (grid_engine/grid_builder.py) from the [0,2,5,10,20,35,55,80]m
# starting point suggested in ros2_ws/interfaces.md v2 SS5, extended to 100m
# to match the mission's outer bound; cell size holds at 5cm out to 10m (the
# "fine detail within a 10m radius" requirement) then grows to 50cm at 100m.
# grid_engine/grid_builder.py's RANGE_BIN_EDGES is the source of truth --
# keep this mirror in sync with it. tracking/clustering.py imports this
# constant directly, so its DBSCAN eps (eps = cell_size * EPS_TO_CELL_RATIO)
# picks up any future change here automatically -- no separate edit needed
# there, but re-tune EPS_TO_CELL_RATIO if clustering quality regresses.
RING_BOUNDARIES = [
    (0.0, 2.0, 0.05),
    (2.0, 5.0, 0.05),
    (5.0, 10.0, 0.05),
    (10.0, 20.0, 0.15),
    (20.0, 35.0, 0.25),
    (35.0, 55.0, 0.35),
    (55.0, 80.0, 0.45),
    (80.0, 100.0, 0.50),
]
