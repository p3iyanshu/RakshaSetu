"""
Task 5 from team_tasks/03_clustering_and_tracking.md

Two things needed for validation only, both derived from SemanticKITTI's raw
per-point label IDs (as stored in the dataset's .label files):

  1. our simplified 6-class scheme -- reused directly from Member 1's real
     data/label_remap.py::RAW_TO_RAKSHASETU rather than a second,
     independently hand-maintained copy of the same table (previously this
     file imported data/class_mapping.py::SEMANTICKITTI_MAP instead, which
     class_mapping.py itself now documents as SUPERSEDED -- it disagrees
     with label_remap.py's approved table on 7 raw ids, e.g. sidewalk/
     other-ground/terrain map to DRIVABLE there vs OTHER_UNKNOWN here, and
     bicyclist/moving-bicyclist map to DYNAMIC_VEHICLE there vs
     DYNAMIC_PEDESTRIAN here. label_remap.py's table is the one actually
     approved and used to train models/checkpoints/best.pth, so importing
     it here is what keeps validation scored against the same class
     boundaries the real model was trained on, instead of a stale table.
  2. the ground-truth moving/non-moving flag SemanticKITTI encodes directly
     in the label ID (e.g. `moving-car` vs `car`) -- this is the ground
     truth our tracker's is_dynamic() decision is validated against. This is
     orthogonal to (1): a `moving-car` point still simplifies to
     DYNAMIC_VEHICLE either way (label_remap.py's RAW_TO_RAKSHASETU already
     maps every moving-X id to its correct simplified class); MOVING_RAW_IDS
     is the separate "confirmed moving in this scan" signal used only for
     validation scoring.

Note one behavioral difference from the old import: label_remap.py's
remap_semantic_ids() raises on any raw id outside the documented SemanticKITTI
taxonomy (0-99, 252-259) instead of silently mapping it to IGNORE, matching
how the real model's training/inference pipeline treats an unmapped id --
real KITTI data should never hit this, but a corrupt/unexpected id now fails
loudly here too instead of being silently absorbed.

RAW_LABEL_NAMES/SEMANTICKITTI_RAW_NAMES: same reasoning applies to the raw-id
-> name table used below for MOVING_RAW_IDS -- imported from label_remap.py
rather than hand-duplicated a second time.

This is the standard public SemanticKITTI label config (raw IDs + names),
reproduced in label_remap.py because the dataset zips ship the .label files
but not the semantic-kitti.yaml config that normally accompanies them.

.label file format: one uint32 per point, low 16 bits = semantic class ID,
high 16 bits = instance ID (see SemanticKITTI API docs).
"""
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from label_remap import remap_semantic_ids, SEMANTICKITTI_RAW_NAMES

# raw_id -> name (kept as a local alias so existing references to
# RAW_LABEL_NAMES in this module don't need to change)
RAW_LABEL_NAMES = SEMANTICKITTI_RAW_NAMES

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
    Member 1's real, approved data/label_remap.py::RAW_TO_RAKSHASETU -- the
    same table the trained model (models/checkpoints/best.pth) was trained
    against. Returns IGNORE_LABEL (-1) for unlabeled/outlier points, same
    convention as label_remap.py; note this differs from the old IGNORE=255
    used by the now-superseded class_mapping.py import this replaced."""
    return remap_semantic_ids(np.asarray(semantic_id))


def to_moving_mask(semantic_id):
    """raw SemanticKITTI semantic ids (N,) -> bool (N,), True = ground-truth
    dynamic (a `moving-X` id in this scan)."""
    return _MOVING_LUT[np.clip(np.asarray(semantic_id), 0, _MAX_RAW_ID - 1)]


def load_velodyne_file(path):
    """Reads a SemanticKITTI .bin velodyne file: float32 x,y,z,intensity,
    returns (N, 4)."""
    return np.fromfile(path, dtype=np.float32).reshape(-1, 4)
