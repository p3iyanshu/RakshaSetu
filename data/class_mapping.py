"""
Collapses each source dataset's raw class taxonomy down to RakshaSetu's
4-class scheme used everywhere downstream of segmentation (shared/schemas.py):

    0   = drivable        -- road surface the vehicle can traverse
    1   = static_obstacle  -- fixed things that block/bound the drivable area
    2   = dynamic_object   -- things that move or can move (vehicles, people)
    255 = ignore           -- unlabeled / not evaluated

Three independent maps, one per source, because each dataset invents its own
raw IDs. All three funnel into the same `remap_labels()` helper.
"""
import numpy as np

DRIVABLE = 0
STATIC_OBSTACLE = 1
DYNAMIC_OBJECT = 2
IGNORE = 255

# ---------------------------------------------------------------------------
# SemanticKITTI (semantic-kitti.org) -- raw IDs from the official devkit's
# semantic-kitti.yaml. Label files store (raw_id | instance_id << 16); we
# only read the lower 16 bits, so these keys are the plain semantic IDs.
# Note "moving-*" (252-259) are the same physical classes as their static
# IDs (10-32) with a "confirmed moving" flag from odometry -- both funnel
# into the same target class here since we don't need that distinction.
# ---------------------------------------------------------------------------
SEMANTICKITTI_MAP = {
    0: IGNORE,              # unlabeled
    1: IGNORE,               # outlier

    40: DRIVABLE,             # road
    44: DRIVABLE,             # parking
    48: DRIVABLE,             # sidewalk
    49: DRIVABLE,             # other-ground
    60: DRIVABLE,             # lane-marking
    72: DRIVABLE,             # terrain (grass/unpaved shoulder -- traversable)

    50: STATIC_OBSTACLE,      # building
    51: STATIC_OBSTACLE,      # fence
    52: STATIC_OBSTACLE,      # other-structure
    70: STATIC_OBSTACLE,      # vegetation
    71: STATIC_OBSTACLE,      # trunk
    80: STATIC_OBSTACLE,      # pole
    81: STATIC_OBSTACLE,      # traffic-sign
    99: STATIC_OBSTACLE,      # other-object

    10: DYNAMIC_OBJECT,       # car
    11: DYNAMIC_OBJECT,       # bicycle
    13: DYNAMIC_OBJECT,       # bus
    15: DYNAMIC_OBJECT,       # motorcycle
    16: DYNAMIC_OBJECT,       # on-rails
    18: DYNAMIC_OBJECT,       # truck
    20: DYNAMIC_OBJECT,       # other-vehicle
    30: DYNAMIC_OBJECT,       # person
    31: DYNAMIC_OBJECT,       # bicyclist
    32: DYNAMIC_OBJECT,       # motorcyclist
    252: DYNAMIC_OBJECT,      # moving-car
    253: DYNAMIC_OBJECT,      # moving-bicyclist
    254: DYNAMIC_OBJECT,      # moving-person
    255: DYNAMIC_OBJECT,      # moving-motorcyclist  (collides with our IGNORE
                              # constant only by numeric coincidence -- this
                              # is a SOURCE id, unrelated to the target IGNORE=255)
    256: DYNAMIC_OBJECT,      # moving-on-rails
    257: DYNAMIC_OBJECT,      # moving-bus
    258: DYNAMIC_OBJECT,      # moving-truck
    259: DYNAMIC_OBJECT,      # moving-other-vehicle
}

SEMANTICKITTI_LABEL_MASK = 0xFFFF  # lower 16 bits of the uint32 .label file = semantic id

# ---------------------------------------------------------------------------
# nuScenes-lidarseg -- category names, NOT fixed integer ids. nuScenes assigns
# each category a lidarseg index per-dataset-version via
# `nusc.lidarseg_idx2name_mapping`, so hardcoding ints here would silently
# mislabel data if that mapping ever shifts. We map by name instead, and
# `build_nuscenes_index_map()` below resolves it to a concrete int->int LUT
# once you actually have a loaded NuScenes object.
# ---------------------------------------------------------------------------
NUSCENES_NAME_MAP = {
    "noise": IGNORE,
    "static.other": IGNORE,

    "flat.driveable_surface": DRIVABLE,
    "flat.sidewalk": DRIVABLE,
    "flat.terrain": DRIVABLE,
    "flat.other": DRIVABLE,

    "static.manmade": STATIC_OBSTACLE,
    "static.vegetation": STATIC_OBSTACLE,
    "static_object.bicycle_rack": STATIC_OBSTACLE,

    "vehicle.car": DYNAMIC_OBJECT,
    "vehicle.truck": DYNAMIC_OBJECT,
    "vehicle.bus.bendy": DYNAMIC_OBJECT,
    "vehicle.bus.rigid": DYNAMIC_OBJECT,
    "vehicle.construction": DYNAMIC_OBJECT,
    "vehicle.emergency.ambulance": DYNAMIC_OBJECT,
    "vehicle.emergency.police": DYNAMIC_OBJECT,
    "vehicle.trailer": DYNAMIC_OBJECT,
    "vehicle.motorcycle": DYNAMIC_OBJECT,
    "vehicle.bicycle": DYNAMIC_OBJECT,
    "human.pedestrian.adult": DYNAMIC_OBJECT,
    "human.pedestrian.child": DYNAMIC_OBJECT,
    "human.pedestrian.wheelchair": DYNAMIC_OBJECT,
    "human.pedestrian.stroller": DYNAMIC_OBJECT,
    "human.pedestrian.personal_mobility": DYNAMIC_OBJECT,
    "human.pedestrian.police_officer": DYNAMIC_OBJECT,
    "human.pedestrian.construction_worker": DYNAMIC_OBJECT,
    "animal": DYNAMIC_OBJECT,
}


def build_nuscenes_index_map(nusc):
    """nusc: a loaded `nuscenes.nuscenes.NuScenes` instance. Returns an
    int->int LUT (lidarseg index -> our 4-class scheme) built from the
    dataset's own idx2name mapping, so it can't drift out of sync with
    whatever version of nuScenes you're using."""
    idx2name = nusc.lidarseg_idx2name_mapping
    max_idx = max(idx2name.keys())
    lut = np.full(max_idx + 1, IGNORE, dtype=np.uint8)
    for idx, name in idx2name.items():
        if name not in NUSCENES_NAME_MAP:
            raise KeyError(f"nuScenes category '{name}' (idx {idx}) has no entry in NUSCENES_NAME_MAP")
        lut[idx] = NUSCENES_NAME_MAP[name]
    return lut

# ---------------------------------------------------------------------------
# CARLA `sensor.lidar.ray_cast_semantic` -- semantic tags are fixed integer
# ids per CARLA release (see CARLA docs "CityScapes Palette" tag table).
# Pinned to CARLA 0.9.15's 23-tag set.
# ---------------------------------------------------------------------------
CARLA_MAP = {
    0: IGNORE,             # Unlabeled
    3: IGNORE,              # Other (rare/ambiguous catch-all)
    13: IGNORE,             # Sky (no meaningful LiDAR return)

    6: DRIVABLE,            # RoadLine
    7: DRIVABLE,             # Road
    8: DRIVABLE,              # SideWalk (matches SemanticKITTI's sidewalk=drivable convention)
    14: DRIVABLE,              # Ground
    22: DRIVABLE,               # Terrain

    1: STATIC_OBSTACLE,     # Building
    2: STATIC_OBSTACLE,      # Fence
    5: STATIC_OBSTACLE,       # Pole
    9: STATIC_OBSTACLE,        # Vegetation
    11: STATIC_OBSTACLE,        # Wall
    12: STATIC_OBSTACLE,         # TrafficSign
    15: STATIC_OBSTACLE,          # Bridge
    16: STATIC_OBSTACLE,           # RailTrack (non-drivable for a road vehicle)
    17: STATIC_OBSTACLE,            # GuardRail
    18: STATIC_OBSTACLE,             # TrafficLight
    19: STATIC_OBSTACLE,              # Static
    21: STATIC_OBSTACLE,               # Water (not drivable; treat as blocking)

    4: DYNAMIC_OBJECT,      # Pedestrian
    10: DYNAMIC_OBJECT,      # Vehicles
    20: DYNAMIC_OBJECT,      # Dynamic (CARLA's catch-all movable-object tag)
}


def remap_labels(raw_labels: np.ndarray, mapping: dict) -> np.ndarray:
    """Vectorized raw-id -> target-class remap via a lookup table.
    Any raw id present in the data but absent from `mapping` becomes IGNORE
    (255) rather than raising -- real datasets occasionally contain stray
    ids not in the published spec, and silently ignoring them is safer than
    crashing training over a handful of stray points.
    """
    raw_labels = np.asarray(raw_labels)
    max_key = max(mapping.keys())
    lut = np.full(max(max_key, int(raw_labels.max()) if raw_labels.size else 0) + 1, IGNORE, dtype=np.uint8)
    for k, v in mapping.items():
        lut[k] = v
    # any raw id >= lut size (shouldn't happen given the max() above, but be safe)
    safe = np.clip(raw_labels, 0, len(lut) - 1)
    return lut[safe]


CLASS_NAMES = {DRIVABLE: "drivable", STATIC_OBSTACLE: "static_obstacle", DYNAMIC_OBJECT: "dynamic_object", IGNORE: "ignore"}
NUM_CLASSES = 3  # drivable, static_obstacle, dynamic_object -- IGNORE is excluded from loss/metrics
