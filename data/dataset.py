"""
dataset.py
RakshaSetu (PS 26053) — Member 1: Data Pipeline & Segmentation Model
Step 4: PyTorch Dataset / DataLoader.

Wires together the four UNCHANGED, already-approved modules
(label_remap.py, cleaning.py, feature_engineering.py) into one
torch.utils.data.Dataset. Does not reimplement or alter any of their
logic — this file only orchestrates calls into them per frame.

STANDARD SPLIT (official SemanticKITTI, matches interfaces.md /
Step 0's documentation-derived split):
    TRAIN_SEQUENCES = 00-07, 09-10
    VAL_SEQUENCES   = 08

DIRECTORY LAYOUT EXPECTED (matches the real dataset's actual structure,
confirmed against the real Drive folder in Step 0):
    <data_root>/sequences/<seq>/velodyne/<frame>.bin
    <data_root>/sequences/<seq>/labels/<frame>.label

============================================================================
DESIGN DECISIONS — each flagged explicitly, none silently assumed
============================================================================

1) UNIT OF __getitem__ = one whole frame (one LiDAR scan), not one point.
   PointNet++-style architectures consume a full point cloud per forward
   pass (hierarchical set abstraction needs neighborhoods), so the natural
   dataset item is "all points in one scan", not a single point.

2) IGNORE_LABEL (-1) points are KEPT in the point cloud, not removed.
   This reverses what might seem like the "obvious" choice (drop them),
   for a specific reason: IGNORE_LABEL was originally defined in
   label_remap.py to "match PyTorch's conventional ignore_index for
   CrossEntropyLoss" — i.e. the intent from Step 1 onward was always to
   let these points flow through and be masked at the LOSS, not deleted
   from the scene. This also matches common published practice for
   SemanticKITTI segmentation (e.g. training with
   `CrossEntropyLoss(ignore_index=...)` while keeping the full point
   cloud's geometry intact for neighborhood context). The alternative
   (drop them entirely at the dataset level) is simpler and was
   considered, but discards real geometric context for the sake of
   convenience — flagged here for your review, not silently decided.

3) FIXED POINT COUNT per sample (NUM_POINTS_PER_SAMPLE, default 8192).
   Real cleaned frames have ~90k-126k points (see Step 2/3 reports), so
   every sample needs to be reduced to a common size for plain tensor
   batching. 8192 is a commonly-used size in point-cloud segmentation
   literature (comparable to PointNet++'s original ScanNet/S3DIS
   setups) — proposed as a reasonable default, not empirically tuned for
   this project's eventual training hardware (unknown to me). This is
   the main "sampling strategy" judgment call and is meant to be revisited
   once real training hardware is confirmed.

4) CLASS-AWARE SAMPLING, IGNORE budget = NATURAL proportion (Strategy 3
   — APPROVED after a real-data comparison against uniform random
   sampling and a fixed-10%-IGNORE variant; see
   compare_sampling_strategies.py for the evidence this decision is
   based on).
   Step 3 found severe class imbalance (other_unknown ~50-58% of points,
   dynamic_pedestrian ~0.1-0.5%). Pure random subsampling would reproduce
   that imbalance point-for-point inside every training sample; the
   real-data comparison confirmed this concretely — uniform random
   sampling produced a training crop with ZERO dynamic_pedestrian points,
   despite the class genuinely being present in the frame, in 14.4% of
   trials, and zero static_obstacle_pole points in 3.1% of trials. The
   sampling here instead:
     a. Computes IGNORE's budget from this frame's OWN natural
        proportion — `ignore_budget = round(num_points * n_ignore /
        n_total)`, capped by how many IGNORE points actually exist in
        this frame. Earlier drafts used a fixed 10% regardless of actual
        occurrence; the comparison showed that inflated IGNORE to ~4x
        its real share (2.46% -> 9.67% averaged across the real test
        frames) for no benefit — the fixed number is now replaced with
        this per-frame, data-derived one.
     b. Splits the REMAINING budget evenly across however many of the 6
        classes are actually PRESENT in this frame, then draws that many
        points uniformly at random *from that class's real points only*.
        If a class has fewer real points than its even share, its
        shortfall is redistributed to the other present classes (never
        invented — only real points already in this frame are ever
        selected).
   This still only ever selects real points that exist in this real
   frame — no point is fabricated, duplicated as "new" data, or
   interpolated. It changes the SELECTION PROBABILITY of which real
   points end up in a given training crop, nothing else.

5) Everything upstream (remap, clean, features) is byte-for-byte the
   already-approved Step 1-3 code, called through their public functions
   only.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import numpy as np
import torch
from torch.utils.data import Dataset

from label_remap import remap_label_file, IGNORE_LABEL, RAKSHASETU_CLASS_NAMES
from cleaning import clean_point_cloud
from feature_engineering import compute_features, FEATURE_NAMES

# --- Official split (documentation-derived, Step 0; matches interfaces.md) ---
TRAIN_SEQUENCES = ["00", "01", "02", "03", "04", "05", "06", "07", "09", "10"]
VAL_SEQUENCES = ["08"]

# --- Sampling design constants ---
# NUM_POINTS_PER_SAMPLE remains a CONFIGURABLE, proposed parameter (pass a
# different value to SemanticKITTIDataset(...) as needed) -- not locked.
NUM_POINTS_PER_SAMPLE: int = 8192
# NOTE: there is no fixed IGNORE fraction constant anymore -- the IGNORE
# budget is now computed per-frame from its natural occurrence (Strategy 3,
# approved). See class_aware_sample_indices() below.
VALID_CLASS_IDS = sorted(RAKSHASETU_CLASS_NAMES.keys())  # [0,1,2,3,4,5]


@dataclass
class FrameEntry:
    seq: str
    frame_id: str
    bin_path: str
    label_path: str


def discover_frames(data_root: str, sequences: list[str]) -> list[FrameEntry]:
    """
    Walk <data_root>/sequences/<seq>/velodyne/*.bin for each requested
    sequence and pair each with its matching .label file. Sequences not
    present under data_root are silently skipped (reported by the
    caller, not hidden) — this lets the same code run against either the
    full dataset or a small local subset without modification.
    """
    entries: list[FrameEntry] = []
    for seq in sequences:
        velodyne_dir = os.path.join(data_root, "sequences", seq, "velodyne")
        labels_dir = os.path.join(data_root, "sequences", seq, "labels")
        if not os.path.isdir(velodyne_dir):
            continue
        for fname in sorted(os.listdir(velodyne_dir)):
            if not fname.endswith(".bin"):
                continue
            frame_id = fname[:-4]
            bin_path = os.path.join(velodyne_dir, fname)
            label_path = os.path.join(labels_dir, frame_id + ".label")
            if not os.path.isfile(label_path):
                raise FileNotFoundError(
                    f"Found {bin_path} but no matching label file {label_path} — "
                    f"refusing to silently skip a point cloud with no ground truth."
                )
            entries.append(FrameEntry(seq, frame_id, bin_path, label_path))
    return entries


def class_aware_sample_indices(
    labels: np.ndarray,
    num_points: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Pick `num_points` indices into `labels` (and the parallel points/
    features arrays) using the APPROVED Strategy 3 class-aware scheme:
    IGNORE gets its NATURAL per-frame proportion (not a fixed constant),
    the rest is split evenly across present valid classes. Returns an
    index array — apply the SAME indices to points, features, and labels
    to keep correspondence exact.
    """
    n = labels.shape[0]
    ignore_idx = np.flatnonzero(labels == IGNORE_LABEL)
    valid_idx_by_class = {c: np.flatnonzero(labels == c) for c in VALID_CLASS_IDS}
    present_classes = [c for c in VALID_CLASS_IDS if valid_idx_by_class[c].size > 0]

    # Strategy 3 (approved): IGNORE budget = this frame's own natural
    # IGNORE proportion, capped by how many IGNORE points actually exist.
    natural_ignore_fraction = (ignore_idx.size / n) if n > 0 else 0.0
    ignore_budget = int(round(num_points * natural_ignore_fraction))
    ignore_budget = min(ignore_budget, ignore_idx.size)
    class_budget_total = num_points - ignore_budget

    selected = []
    if ignore_budget > 0:
        selected.append(rng.choice(ignore_idx, size=ignore_budget, replace=False))

    if present_classes:
        remaining = class_budget_total
        classes_left = list(present_classes)
        # Even split with shortfall redistribution: repeatedly divide whatever
        # budget remains across whichever classes still have supply left.
        allocation = {c: 0 for c in present_classes}
        while remaining > 0 and classes_left:
            share = max(1, remaining // len(classes_left))
            still_has_room = []
            for c in classes_left:
                available = valid_idx_by_class[c].size - allocation[c]
                take = min(share, available, remaining)
                allocation[c] += take
                remaining -= take
                if valid_idx_by_class[c].size - allocation[c] > 0 and remaining > 0:
                    still_has_room.append(c)
                if remaining <= 0:
                    break
            if still_has_room == classes_left:
                # no class made progress this round (all exactly exhausted) -> stop
                break
            classes_left = still_has_room

        for c in present_classes:
            k = allocation[c]
            if k > 0:
                selected.append(rng.choice(valid_idx_by_class[c], size=k, replace=False))

    if not selected:
        # Degenerate case: frame has no ignore points and no valid points at
        # all (shouldn't happen for a real, non-empty frame, but handled
        # rather than assumed away).
        return np.arange(min(num_points, n))

    idx = np.concatenate(selected)
    # If still short (e.g. a frame genuinely has fewer real points than
    # num_points), fill the remainder by sampling WITH replacement from
    # whatever real points exist — still only real points, just reused.
    if idx.shape[0] < num_points:
        extra = rng.choice(n, size=num_points - idx.shape[0], replace=True)
        idx = np.concatenate([idx, extra])
    rng.shuffle(idx)
    return idx[:num_points]


class SemanticKITTIDataset(Dataset):
    """
    One item = one LiDAR frame, processed through the approved
    remap -> clean -> feature pipeline, then reduced to a fixed
    NUM_POINTS_PER_SAMPLE via class-aware sampling.

    __getitem__ returns a dict:
        xyz:      (NUM_POINTS_PER_SAMPLE, 3) float32 — raw ego-frame x,y,z
        features: (NUM_POINTS_PER_SAMPLE, 7) float32 — the 7 approved
                  features, in feature_engineering.FEATURE_NAMES order
        labels:   (NUM_POINTS_PER_SAMPLE,)    int64   — values in
                  {-1, 0, 1, 2, 3, 4, 5}; -1 = IGNORE_LABEL, must be
                  passed as ignore_index to the eventual loss function
        seq, frame_id: strings, for traceability/debugging

    xyz is returned RAW (un-normalized, ego-vehicle frame per
    interfaces.md's convention) — any centering/scaling is left as a
    model-side decision (Step 5), not baked into the dataset.
    """

    def __init__(
        self,
        data_root: str,
        sequences: list[str],
        num_points_per_sample: int = NUM_POINTS_PER_SAMPLE,
        seed: int | None = None,
    ):
        self.entries = discover_frames(data_root, sequences)
        if len(self.entries) == 0:
            raise RuntimeError(
                f"No frames found under {data_root} for sequences {sequences}. "
                f"Check data_root layout: <data_root>/sequences/<seq>/velodyne/*.bin"
            )
        self.num_points_per_sample = num_points_per_sample
        self._seed = seed

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, idx: int) -> dict:
        entry = self.entries[idx]
        raw_points = np.fromfile(entry.bin_path, dtype=np.float32).reshape(-1, 4)
        raw_labels_u32 = np.fromfile(entry.label_path, dtype=np.uint32)

        six_class_labels = remap_label_file(raw_labels_u32)                    # Step 1, unchanged
        clean_points, clean_labels, _ = clean_point_cloud(raw_points, six_class_labels)  # Step 2, unchanged
        feats_dict, _ = compute_features(clean_points)                        # Step 3, unchanged
        feats = np.stack([feats_dict[name] for name in FEATURE_NAMES], axis=1).astype(np.float32)

        # Per-item RNG seeded from (dataset seed, idx) so results are
        # reproducible across runs/workers but still vary sample-to-sample.
        seed_material = (self._seed or 0) * 1_000_003 + idx
        rng = np.random.default_rng(seed_material)

        sel = class_aware_sample_indices(
            clean_labels, self.num_points_per_sample, rng
        )

        xyz = clean_points[sel, :3]
        sampled_features = feats[sel]
        sampled_labels = clean_labels[sel]

        return {
            "xyz": torch.from_numpy(xyz.copy()),
            "features": torch.from_numpy(sampled_features.copy()),
            "labels": torch.from_numpy(sampled_labels.astype(np.int64).copy()),
            "seq": entry.seq,
            "frame_id": entry.frame_id,
        }
