"""
Task 5 from team_tasks/03_clustering_and_tracking.md

Two things needed for validation only, both derived from SemanticKITTI's raw
per-point label IDs (as stored in the dataset's .label files):

  1. our simplified 6-class scheme -- reused directly from Member 1's real
     data/class_mapping.py::SEMANTICKITTI_MAP rather than a second,
     independently hand-maintained copy of the same table (v1 of this file
     predated class_mapping.py and duplicated an approximation of it; now
     that the real one exists and is committed, importing it instead is
     what keeps the two from silently drifting apart again).
  2. the ground-truth moving/non-moving flag SemanticKITTI encodes directly
     in the label ID (e.g. `moving-car` vs `car`) -- this is the ground
     truth our tracker's is_dynamic() decision is validated against. This is
     orthogonal to (1): a `moving-car` point still simplifies to
     DYNAMIC_VEHICLE either way (class_mapping.py's SEMANTICKITTI_MAP
     already maps every moving-X id to its correct simplified class);
     MOVING_RAW_IDS is the separate "confirmed moving in this scan" signal
     used only for validation scoring.

This is the standard public SemanticKITTI label config (raw IDs + names),
reproduced here because the dataset zips ship the .label files but not the
semantic-kitti.yaml config that normally accompanies them.

.label file format: one uint32 per point, low 16 bits = semantic class ID,
high 16 bits = instance ID (see SemanticKITTI API docs).
"""
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from class_mapping import SEMANTICKITTI_MAP, remap_labels

# raw_id -> name
RAW_LABEL_NAMES = {
    0: "unlabeled", 1: "outlier",
    10: "car", 11: "bicycle", 13: "bus", 15: "motorcycle", 16: "on-rails",
    18: "truck", 20: "other-vehicle", 30: "person", 31: "bicyclist",
    32: "motorcyclist", 40: "road", 44: "parking", 48: "sidewalk",
    49: "other-ground", 50: "building", 51: "fence", 52: "other-structure",
    60: "lane-marking", 70: "vegetation", 71: "trunk", 72: "terrain",
    80: "pole", 81: "traffic-sign", 99: "other-object",
    252: "moving-car", 253: "moving-bicyclist", 254: "moving-person",
    255: "moving-motorcyclist", 256: "moving-on-rails", 257: "moving-bus",
    258: "moving-truck", 259: "moving-other-vehicle",
}

# The "moving-X" IDs (252-259) are SemanticKITTI's ground truth for dynamic
# objects; every other labeled class is static in that scan. Orthogonal to
# the simplified-class mapping -- see module docstring.
MOVING_RAW_IDS = frozenset(k for k in RAW_LABEL_NAMES if k >= 252)

# Precompute a fast lookup table since raw ids are small ints (0-259).
_MAX_RAW_ID = 260
_MOVING_LUT = np.zeros(_MAX_RAW_ID, dtype=bool)
for _raw_id in RAW_LABEL_NAMES:
    _MOVING_LUT[_raw_id] = _raw_id in MOVING_RAW_IDS


def load_label_file(path):
    """Reads a SemanticKITTI .label file, returns (semantic_id, instance_id),
    each shape (N,)."""
    raw = np.fromfile(path, dtype=np.uint32)
    semantic_id = (raw & 0xFFFF).astype(np.int64)
    instance_id = (raw >> 16).astype(np.int64)
    return semantic_id, instance_id


def to_simplified_labels(semantic_id):
    """raw SemanticKITTI semantic ids (N,) -> our 6-class scheme (N,), via
    Member 1's real data/class_mapping.py::SEMANTICKITTI_MAP."""
    return remap_labels(np.asarray(semantic_id), SEMANTICKITTI_MAP)


def to_moving_mask(semantic_id):
    """raw SemanticKITTI semantic ids (N,) -> bool (N,), True = ground-truth
    dynamic (a `moving-X` id in this scan)."""
    return _MOVING_LUT[np.clip(np.asarray(semantic_id), 0, _MAX_RAW_ID - 1)]


def load_velodyne_file(path):
    """Reads a SemanticKITTI .bin velodyne file: float32 x,y,z,intensity,
    returns (N, 4)."""
    return np.fromfile(path, dtype=np.float32).reshape(-1, 4)
