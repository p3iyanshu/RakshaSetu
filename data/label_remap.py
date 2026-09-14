"""
label_remap.py
RakshaSetu (PS 26053) — Member 1: Data Pipeline & Segmentation Model
Class-remapping layer: raw SemanticKITTI label IDs -> the 6 official
RakshaSetu classes defined in `interfaces.md` (section 4, "Segmentation
-> per-point labels"):

    0 = drivable_terrain
    1 = static_obstacle_wall
    2 = static_obstacle_pole
    3 = dynamic_vehicle
    4 = dynamic_pedestrian
    5 = other / unknown

IMPORTANT SCOPE NOTE: `interfaces.md` only fixes the *output* of this
mapping (the 6 class IDs above, locked, do not renumber). It says
nothing about SemanticKITTI's raw label taxonomy — that mapping is a
Member-1-specific dataset-decoding decision. The raw ID -> 6-class
table below was proposed by Member 1 and explicitly approved,
judgment-call by judgment-call, by the team lead. It is NOT sourced
from `interfaces.md` and does not modify that file in any way.

Raw taxonomy source: the official SemanticKITTI label config
(github.com/PRBonn/semantic-kitti-api, config/semantic-kitti.yaml).
Verified directly against real .label files from sequences 00, 03,
08, and 09 of this project's dataset (see verify_remap.py / the
Step-0 report) — every raw ID this module handles has been observed
in real data, not assumed from documentation alone.

.label file format (per SemanticKITTI docs, confirmed against real
files): one uint32 per point.
    lower 16 bits = semantic class id
    upper 16 bits = instance id (only meaningful for "thing" classes)
This module only consumes the semantic (lower 16-bit) part.
"""

from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# RakshaSetu 6-class scheme (locked — from interfaces.md, do not renumber)
# ---------------------------------------------------------------------------

RAKSHASETU_CLASS_NAMES: dict[int, str] = {
    0: "drivable_terrain",
    1: "static_obstacle_wall",
    2: "static_obstacle_pole",
    3: "dynamic_vehicle",
    4: "dynamic_pedestrian",
    5: "other_unknown",
}

# Sentinel for points that must NOT participate in classification at all
# (SemanticKITTI's own "unlabeled"/"outlier" raw classes). This is not one
# of the 6 official classes — it marks "not a valid training/eval point".
# Chosen to match PyTorch's conventional ignore_index for CrossEntropyLoss.
IGNORE_LABEL: int = -1

# ---------------------------------------------------------------------------
# Raw SemanticKITTI semantic IDs -> human-readable names
# (from the official semantic-kitti.yaml `labels:` block — reference only,
#  not used in the numeric remap itself)
# ---------------------------------------------------------------------------

SEMANTICKITTI_RAW_NAMES: dict[int, str] = {
    0: "unlabeled",
    1: "outlier",
    10: "car",
    11: "bicycle",
    13: "bus",
    15: "motorcycle",
    16: "on-rails",
    18: "truck",
    20: "other-vehicle",
    30: "person",
    31: "bicyclist",
    32: "motorcyclist",
    40: "road",
    44: "parking",
    48: "sidewalk",
    49: "other-ground",
    50: "building",
    51: "fence",
    52: "other-structure",
    60: "lane-marking",
    70: "vegetation",
    71: "trunk",
    72: "terrain",
    80: "pole",
    81: "traffic-sign",
    99: "other-object",
    252: "moving-car",
    253: "moving-bicyclist",
    254: "moving-person",
    255: "moving-motorcyclist",
    256: "moving-on-rails",
    257: "moving-bus",
    258: "moving-truck",
    259: "moving-other-vehicle",
}

# ---------------------------------------------------------------------------
# THE approved mapping: raw SemanticKITTI semantic ID -> RakshaSetu class
# (or IGNORE_LABEL for excluded raw classes)
#
# Every row below was explicitly reviewed. "clear" rows had no reasonable
# alternative; "judgment call" rows were proposed by Member 1 and then
# explicitly approved by the team lead in conversation — see the rationale
# comment on each.
# ---------------------------------------------------------------------------

RAW_TO_RAKSHASETU: dict[int, int] = {
    # --- excluded: no usable ground truth (clear) ---
    0: IGNORE_LABEL,   # unlabeled — official benchmark ignores this class entirely
    1: IGNORE_LABEL,   # outlier — documented sensor noise, dropped at cleaning stage

    # --- 0: drivable_terrain ---
    40: 0,             # road (clear)
    60: 0,             # lane-marking — paint on the road surface (clear)
    44: 0,             # parking — paved, vehicle can occupy/drive on it (APPROVED judgment call)

    # --- 1: static_obstacle_wall ---
    50: 1,             # building (clear)
    51: 1,             # fence — planar vertical obstacle, closer to wall than pole (APPROVED judgment call)

    # --- 2: static_obstacle_pole ---
    80: 2,             # pole (clear)
    81: 2,             # traffic-sign — usually pole-mounted, thin obstacle profile (APPROVED judgment call)
    71: 2,             # trunk — thin vertical obstacle, closest fit among the 6 classes (APPROVED judgment call)

    # --- 3: dynamic_vehicle ---
    10: 3,             # car (clear)
    11: 3,             # bicycle — standalone/unridden object (clear)
    13: 3,             # bus (clear)
    15: 3,             # motorcycle — standalone/unridden object (clear)
    16: 3,             # on-rails (clear)
    18: 3,             # truck (clear)
    20: 3,             # other-vehicle (clear)
    31: 3,             # bicyclist — rider+vehicle merged class (APPROVED: vehicle, not pedestrian)
    32: 3,             # motorcyclist — rider+vehicle merged class (APPROVED: vehicle, not pedestrian)
    252: 3,            # moving-car (clear — same object type as car)
    253: 3,            # moving-bicyclist (APPROVED, mirrors bicyclist decision)
    255: 3,            # moving-motorcyclist (APPROVED, mirrors motorcyclist decision)
    256: 3,            # moving-on-rails (clear)
    257: 3,            # moving-bus (clear)
    258: 3,            # moving-truck (clear)
    259: 3,            # moving-other-vehicle (clear)

    # --- 4: dynamic_pedestrian ---
    30: 4,             # person (clear)
    254: 4,            # moving-person (clear)

    # --- 5: other_unknown ---
    48: 5,             # sidewalk — paved but not meant for vehicle travel (APPROVED judgment call)
    49: 5,             # other-ground — already a catch-all in source taxonomy (clear)
    52: 5,             # other-structure — already a catch-all in source taxonomy (clear)
    99: 5,             # other-object — already a catch-all in source taxonomy (clear)
    70: 5,             # vegetation — no better fit among the 6 classes (APPROVED judgment call)
    72: 5,             # terrain — non-drivable ground beside the road, not "road"/"sidewalk" (APPROVED judgment call)
}

# Build a dense NumPy lookup table once, at import time, for fast vectorized
# remapping. Any raw ID NOT in RAW_TO_RAKSHASETU maps to _UNSEEN_SENTINEL so
# that an unexpected/unmapped raw ID fails loudly instead of being silently
# miscategorized.
_UNSEEN_SENTINEL = -2
_MAX_RAW_ID = max(RAW_TO_RAKSHASETU.keys())
_LOOKUP = np.full(_MAX_RAW_ID + 1, _UNSEEN_SENTINEL, dtype=np.int8)
for _raw_id, _class_id in RAW_TO_RAKSHASETU.items():
    _LOOKUP[_raw_id] = _class_id


def split_semantic_and_instance(raw_labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Split a raw SemanticKITTI .label array (uint32 per point) into its
    semantic-class component (lower 16 bits) and instance-id component
    (upper 16 bits), per the documented .label format.
    """
    raw_labels = raw_labels.astype(np.uint32, copy=False)
    semantic_id = raw_labels & 0xFFFF
    instance_id = raw_labels >> 16
    return semantic_id, instance_id


def remap_semantic_ids(semantic_id: np.ndarray) -> np.ndarray:
    """
    Vectorized remap of raw SemanticKITTI semantic IDs (lower 16 bits,
    already extracted) to RakshaSetu's 6-class scheme.

    Returns an int8 array with values in {-1, 0, 1, 2, 3, 4, 5}:
        -1                -> IGNORE_LABEL (raw 0 unlabeled / 1 outlier)
        0..5               -> one of the 6 RakshaSetu classes

    Raises ValueError if any input ID is not in the known raw taxonomy
    (0-99, 252-259) — this is intentional: an unmapped ID means either
    corrupt data or an undocumented raw class, and must not be silently
    absorbed into some default class.
    """
    semantic_id = semantic_id.astype(np.int64, copy=False)
    if semantic_id.min() < 0 or semantic_id.max() > _MAX_RAW_ID:
        bad = semantic_id[(semantic_id < 0) | (semantic_id > _MAX_RAW_ID)]
        raise ValueError(
            f"Encountered raw semantic ID(s) outside the known SemanticKITTI "
            f"range [0, {_MAX_RAW_ID}]: {np.unique(bad).tolist()[:10]}"
        )
    remapped = _LOOKUP[semantic_id]
    unseen_mask = remapped == _UNSEEN_SENTINEL
    if unseen_mask.any():
        bad_ids = np.unique(semantic_id[unseen_mask]).tolist()
        raise ValueError(
            f"Raw semantic ID(s) {bad_ids} have no entry in RAW_TO_RAKSHASETU. "
            f"This must be resolved explicitly (see mapping-decision table) "
            f"before proceeding — no silent default is applied."
        )
    return remapped


def remap_label_file(raw_labels: np.ndarray) -> np.ndarray:
    """
    End-to-end convenience wrapper: takes the raw uint32 array exactly as
    read from a SemanticKITTI .label file (instance bits and all) and
    returns the RakshaSetu 6-class (+ IGNORE_LABEL) array, same length,
    same point order.
    """
    semantic_id, _instance_id = split_semantic_and_instance(raw_labels)
    return remap_semantic_ids(semantic_id)


def class_histogram(labels: np.ndarray, names: dict[int, str]) -> list[tuple[int, str, int]]:
    """Small reporting helper: (id, name, count) sorted by id."""
    vals, counts = np.unique(labels, return_counts=True)
    out = []
    for v, c in zip(vals.tolist(), counts.tolist()):
        label_name = names.get(v, "IGNORE" if v == IGNORE_LABEL else f"UNKNOWN({v})")
        out.append((v, label_name, c))
    return out


# ---------------------------------------------------------------------------
# Self-check run at import time: every documented raw ID (0-99, 252-259)
# must have an explicit entry (mapped class or IGNORE_LABEL). Catches typos
# or accidental omissions in RAW_TO_RAKSHASETU immediately on import.
# ---------------------------------------------------------------------------
_ALL_DOCUMENTED_RAW_IDS = set(SEMANTICKITTI_RAW_NAMES.keys())
_MISSING = _ALL_DOCUMENTED_RAW_IDS - set(RAW_TO_RAKSHASETU.keys())
if _MISSING:
    raise RuntimeError(
        f"label_remap.py is missing mapping entries for documented raw IDs: "
        f"{sorted(_MISSING)}. Every raw ID in SEMANTICKITTI_RAW_NAMES must "
        f"appear in RAW_TO_RAKSHASETU."
    )
