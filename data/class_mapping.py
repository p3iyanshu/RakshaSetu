"""
Collapses each source dataset's raw class taxonomy down to RakshaSetu's
6-class scheme used everywhere downstream of segmentation (shared/schemas.py):

    0   = drivable               -- road surface the vehicle can traverse
    1   = static_obstacle_wall    -- fixed, bulky/planar things that block/bound the drivable area
    2   = static_obstacle_pole    -- fixed, narrow/vertical things (poles, signs, trunks)
    3   = dynamic_vehicle          -- vehicles (moving or parked)
    4   = dynamic_pedestrian        -- people (and people-scale movers)
    5   = other_unknown              -- a real object that doesn't cleanly fit the above
    255 = ignore                      -- unlabeled / not evaluated (training-time only)

v2 (2026-09-12): migrated from the original 3-class scheme (drivable /
static_obstacle / dynamic_object) to this 6-class scheme, per Member 4's
ros2_ws/interfaces.md v2 SS4. Several of the mappings below split a single
raw source class across the new wall/pole or vehicle/pedestrian boundary --
those are marked "REVIEW:" and are this module owner's best first-pass
judgment call, not something interfaces.md itself specifies. Confirm/adjust
with the team rather than treating them as final.

Three independent maps, one per source, because each dataset invents its own
raw IDs. All three funnel into the same `remap_labels()` helper.

!! SEMANTICKITTI_MAP BELOW IS SUPERSEDED, DO NOT USE FOR NEW WORK !!
The team has since reviewed and approved a different, authoritative
SemanticKITTI raw-id mapping: data/label_remap.py's RAW_TO_RAKSHASETU (see
Member1_HANDOVER_REPORT.md). It disagrees with the (unreviewed) table below
on 7 raw ids -- notably sidewalk/other-ground/terrain (drivable here vs.
other_unknown there) and bicyclist/moving-bicyclist (dynamic_pedestrian here
vs. dynamic_vehicle there). tracking/semantic_kitti_labels.py has been
switched to import label_remap.py's RAW_TO_RAKSHASETU instead, for
consistency with the actual trained model -- SEMANTICKITTI_MAP below is now
unused by any other module and kept only for historical reference; do not
reintroduce a new import of it. NUSCENES_NAME_MAP and CARLA_MAP below are
unaffected (no equivalent approved table exists for those sources yet).
"""
import numpy as np

DRIVABLE = 0
STATIC_OBSTACLE_WALL = 1
STATIC_OBSTACLE_POLE = 2
DYNAMIC_VEHICLE = 3
DYNAMIC_PEDESTRIAN = 4
OTHER_UNKNOWN = 5
IGNORE = 255

# ---------------------------------------------------------------------------
# SemanticKITTI (semantic-kitti.org) -- raw IDs from the official devkit's
# semantic-kitti.yaml. Label files store (raw_id | instance_id << 16); we
# only read the lower 16 bits, so these keys are the plain semantic IDs.
# Note "moving-*" (252-259) are the same physical classes as their static
# IDs (10-32) with a "confirmed moving" flag from odometry -- both funnel
# into the same target class here since we don't need that distinction
# (Member 3's tracker derives is_dynamic itself, from observed motion).
# ---------------------------------------------------------------------------
SEMANTICKITTI_MAP = {
    0: IGNORE,               # unlabeled
    1: IGNORE,                # outlier

    40: DRIVABLE,              # road
    44: DRIVABLE,               # parking
    48: DRIVABLE,                # sidewalk
    49: DRIVABLE,                 # other-ground
    60: DRIVABLE,                  # lane-marking
    72: DRIVABLE,                   # terrain (grass/unpaved shoulder -- traversable)

    50: STATIC_OBSTACLE_WALL,   # building
    51: STATIC_OBSTACLE_WALL,    # fence
    52: STATIC_OBSTACLE_WALL,     # other-structure
    70: STATIC_OBSTACLE_WALL,      # vegetation -- REVIEW: bulky/planar (bushes, tree canopy) treated as wall-like; a thin sapling would arguably read more like a pole
    71: STATIC_OBSTACLE_POLE,       # trunk -- narrow and vertical, unlike the canopy above it

    80: STATIC_OBSTACLE_POLE,   # pole
    81: STATIC_OBSTACLE_POLE,    # traffic-sign -- REVIEW: post-mounted and narrow, grouped with pole rather than wall
    99: OTHER_UNKNOWN,            # other-object -- REVIEW: genuinely ambiguous catch-all, doesn't indicate a shape

    10: DYNAMIC_VEHICLE,        # car
    11: DYNAMIC_VEHICLE,         # bicycle
    13: DYNAMIC_VEHICLE,          # bus
    15: DYNAMIC_VEHICLE,           # motorcycle
    16: DYNAMIC_VEHICLE,            # on-rails
    18: DYNAMIC_VEHICLE,             # truck
    20: DYNAMIC_VEHICLE,              # other-vehicle
    252: DYNAMIC_VEHICLE,              # moving-car
    256: DYNAMIC_VEHICLE,               # moving-on-rails
    257: DYNAMIC_VEHICLE,                # moving-bus
    258: DYNAMIC_VEHICLE,                 # moving-truck
    259: DYNAMIC_VEHICLE,                  # moving-other-vehicle
    32: DYNAMIC_VEHICLE,                    # motorcyclist -- REVIEW: a person riding one, but grouped with vehicle since it moves at vehicle speed/behavior, not pedestrian speed (contrast with bicyclist below)
    255: DYNAMIC_VEHICLE,                    # moving-motorcyclist (this is a SOURCE id -- collides with our own target IGNORE=255 only by numeric coincidence, unrelated to it)

    30: DYNAMIC_PEDESTRIAN,     # person
    31: DYNAMIC_PEDESTRIAN,      # bicyclist -- REVIEW: a person riding a bicycle; grouped with pedestrian (not vehicle) since behavior/speed is closer to a pedestrian's than a motor vehicle's
    253: DYNAMIC_PEDESTRIAN,      # moving-bicyclist
    254: DYNAMIC_PEDESTRIAN,       # moving-person
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
    "static.other": OTHER_UNKNOWN,   # REVIEW: a real static object of unspecified type -- distinct from "noise" (not a real return at all), so OTHER_UNKNOWN rather than IGNORE

    "flat.driveable_surface": DRIVABLE,
    "flat.sidewalk": DRIVABLE,
    "flat.terrain": DRIVABLE,
    "flat.other": DRIVABLE,

    "static.manmade": STATIC_OBSTACLE_WALL,
    "static.vegetation": STATIC_OBSTACLE_WALL,
    "static_object.bicycle_rack": STATIC_OBSTACLE_POLE,  # REVIEW: thin tubular structure, grouped with pole rather than wall

    "vehicle.car": DYNAMIC_VEHICLE,
    "vehicle.truck": DYNAMIC_VEHICLE,
    "vehicle.bus.bendy": DYNAMIC_VEHICLE,
    "vehicle.bus.rigid": DYNAMIC_VEHICLE,
    "vehicle.construction": DYNAMIC_VEHICLE,
    "vehicle.emergency.ambulance": DYNAMIC_VEHICLE,
    "vehicle.emergency.police": DYNAMIC_VEHICLE,
    "vehicle.trailer": DYNAMIC_VEHICLE,
    "vehicle.motorcycle": DYNAMIC_VEHICLE,
    "vehicle.bicycle": DYNAMIC_VEHICLE,

    "human.pedestrian.adult": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.child": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.wheelchair": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.stroller": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.personal_mobility": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.police_officer": DYNAMIC_PEDESTRIAN,
    "human.pedestrian.construction_worker": DYNAMIC_PEDESTRIAN,
    "animal": OTHER_UNKNOWN,   # REVIEW: neither a vehicle nor a human pedestrian; tracking's own motion-based is_dynamic logic still applies regardless of this class label
}


def build_nuscenes_index_map(nusc):
    """nusc: a loaded `nuscenes.nuscenes.NuScenes` instance. Returns an
    int->int LUT (lidarseg index -> our 6-class scheme) built from the
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
    0: IGNORE,              # Unlabeled
    13: IGNORE,               # Sky (no meaningful LiDAR return)
    3: OTHER_UNKNOWN,          # Other -- REVIEW: CARLA's rare/ambiguous catch-all; a real (if unclear) return, so OTHER_UNKNOWN rather than IGNORE

    6: DRIVABLE,             # RoadLine
    7: DRIVABLE,              # Road
    8: DRIVABLE,               # SideWalk (matches SemanticKITTI's sidewalk=drivable convention)
    14: DRIVABLE,               # Ground
    22: DRIVABLE,                # Terrain

    1: STATIC_OBSTACLE_WALL,   # Building
    2: STATIC_OBSTACLE_WALL,    # Fence
    9: STATIC_OBSTACLE_WALL,     # Vegetation
    11: STATIC_OBSTACLE_WALL,     # Wall
    15: STATIC_OBSTACLE_WALL,      # Bridge
    16: STATIC_OBSTACLE_WALL,       # RailTrack (non-drivable for a road vehicle)
    17: STATIC_OBSTACLE_WALL,        # GuardRail

    5: STATIC_OBSTACLE_POLE,    # Pole
    12: STATIC_OBSTACLE_POLE,    # TrafficSign
    18: STATIC_OBSTACLE_POLE,     # TrafficLight -- REVIEW: pole-mounted, grouped with pole

    19: OTHER_UNKNOWN,   # Static -- REVIEW: CARLA's generic static-prop catch-all, doesn't indicate wall vs pole
    21: OTHER_UNKNOWN,    # Water -- REVIEW: non-drivable and blocking, but not wall/pole-shaped

    4: DYNAMIC_PEDESTRIAN,   # Pedestrian (numeric coincidence: CARLA's raw id 4 happens to equal our own target DYNAMIC_PEDESTRIAN=4 -- unrelated namespaces, just a coincidence, same situation as SemanticKITTI's moving-motorcyclist=255 above)
    10: DYNAMIC_VEHICLE,      # Vehicles
    20: OTHER_UNKNOWN,         # Dynamic -- REVIEW: CARLA's catch-all movable-object tag; can't tell vehicle from pedestrian from this alone, so left as OTHER_UNKNOWN rather than guessing
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


CLASS_NAMES = {
    DRIVABLE: "drivable",
    STATIC_OBSTACLE_WALL: "static_obstacle_wall",
    STATIC_OBSTACLE_POLE: "static_obstacle_pole",
    DYNAMIC_VEHICLE: "dynamic_vehicle",
    DYNAMIC_PEDESTRIAN: "dynamic_pedestrian",
    OTHER_UNKNOWN: "other_unknown",
    IGNORE: "ignore",
}
NUM_CLASSES = 6  # drivable, static_obstacle_wall, static_obstacle_pole, dynamic_vehicle, dynamic_pedestrian, other_unknown -- IGNORE is excluded from loss/metrics
