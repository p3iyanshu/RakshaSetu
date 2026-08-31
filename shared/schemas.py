"""
The single source of truth for data shapes passed between modules.
See team_tasks/00_interfaces_and_handoff.md for the full handoff process.
Import from here -- never redefine these shapes locally.
"""
from dataclasses import dataclass

# Class labels used everywhere downstream of segmentation.
# NOTE: these are OUR simplified 4-class scheme, already remapped from
# whatever raw taxonomy a real dataset (e.g. SemanticKITTI's 19-28 classes)
# uses. Member 1 owns the raw-to-simplified remapping (class_mapping.py);
# everyone else only ever sees these 4 values.
DRIVABLE = 0
STATIC_OBSTACLE = 1
DYNAMIC_OBJECT = 2
IGNORE = 255

# ---- Stage 1: Raw ingest ----
# points: np.ndarray, shape (N, 4) -> columns: x, y, z, intensity

# ---- Stage 2: Segmentation output (Member 1 -> Members 2, 3) ----
@dataclass
class SegmentationOutput:
    labels: "np.ndarray"        # shape (N,), values in {0, 1, 2, 255}
    confidence: "np.ndarray"    # shape (N,), float in [0.0, 1.0]

# ---- Stage 3: Grid Engine output (Member 2 -> Member 4) ----
@dataclass
class GridCell:
    ring: int                   # 0-3, which resolution band (5cm/15cm/30cm/50cm)
    angular_bin: int
    cls: int                    # 0=drivable, 1=static_obstacle, 2=dynamic_object
    height_max: float
    height_mean: float
    point_count: int
    confidence: float
# Full grid = dict[(ring, angular_bin), GridCell]

# ---- Stage 4: Tracking output (Member 3 -> Member 4) ----
@dataclass
class TrackedObject:
    track_id: int
    cls: int                    # 1=static_obstacle, 2=dynamic_object
    position: tuple             # (x, y, z)
    velocity: tuple             # (vx, vy)
    is_dynamic: bool
    confidence: float

# ---- Stage 5: Fusion output (Member 4 -> Member 5's dashboard) ----
@dataclass
class FusedFrame:
    timestamp: float
    grid: list                  # list[GridCell]
    objects: list                # list[TrackedObject]
    metrics: dict                 # {"fps": float, "latency_ms": float, "miou": float, "compute_savings_pct": float}

# Same radial resolution bands used by the grid engine and by clustering's
# distance-adaptive eps -- keep this the one place both read from.
RING_BOUNDARIES = [
    (0.0, 10.0, 0.05),
    (10.0, 30.0, 0.15),
    (30.0, 60.0, 0.30),
    (60.0, 100.0, 0.50),
]
