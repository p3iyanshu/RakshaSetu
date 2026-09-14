"""
cleaning.py
RakshaSetu (PS 26053) — Member 1: Data Pipeline & Segmentation Model
Step 2: Cleaning.

Two, and only two, removal rules are applied, in this order:

  1. NaN/Inf removal — a point is dropped if ANY of x, y, z, intensity is
     non-finite. This needs no external justification: a non-finite value
     is a data-corruption artifact, not a real physical measurement, under
     any threshold policy.

  2. Sensor-physical-range sanity filter — a point is dropped if its
     Euclidean range r = sqrt(x^2 + y^2 + z^2) falls outside the DOCUMENTED
     valid operating envelope of the sensor that captured this dataset.

THRESHOLD JUSTIFICATION (not an invented number):
KITTI's raw scans (which SemanticKITTI's labels are built on top of) were
captured with a Velodyne HDL-64E. Velodyne's own HDL-64E S2/S3 User's
Manual states explicitly:
    "Valid Data Range: 0.9 m to 120 m (3' to 394')"
    "The minimum return distance for the sensor is approximately 3 feet
     (0.9 meters)."
    "...usable returns up to 120 meters."
(sources: Velodyne HDL-64E S2/S2.1 and S3 User's Manuals)

So MIN_VALID_RANGE_M = 0.9 and MAX_VALID_RANGE_M = 120.0 are the sensor's
own documented physical limits, not a percentile or round number picked
by inspection of this dataset. Points outside this window are physically
impossible outputs of this specific sensor and must be sensor artifacts
(e.g. internal reflections, decoding glitches), not real returns.

REAL-DATA VALIDATION (see verify_cleaning.py): across 4 real frames from
4 different sequences (00, 03, 08, 09; ~497k points total), the observed
range was [1.277 m, 80.396 m] — comfortably inside [0.9, 120] m with a
wide margin on both ends, and zero points were found outside that sensor
envelope in any tested frame. This filter is therefore a defensive safety
net grounded in sensor spec, not a rule "discovered" to be necessary from
this sample — see the per-frame report for the honest, currently-zero,
removal counts.

Cleaning is applied to (points, labels) pairs and is agnostic to what the
label array actually contains (raw SemanticKITTI ids, or already-remapped
RakshaSetu 6-class ids from label_remap.py) — it only needs points and
labels to have the same length N and the same point order, which is the
same invariant label_remap.py already guarantees.
"""

from __future__ import annotations

import numpy as np

# Velodyne HDL-64E documented valid data range (see module docstring for source).
MIN_VALID_RANGE_M: float = 0.9
MAX_VALID_RANGE_M: float = 120.0


def clean_point_cloud(
    points: np.ndarray,
    labels: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """
    Clean one frame's point cloud, keeping a parallel label array in sync.

    Args:
        points: (N, 4) float32 array, columns [x, y, z, intensity].
        labels: (N,) array, any dtype — one label per point, same order
                as `points` (raw SemanticKITTI id, remapped 6-class id,
                whatever the caller is carrying alongside the points).

    Returns:
        clean_points: (M, 4) float32, M <= N, same column layout.
        clean_labels: (M,) same dtype as `labels`, same order, exact
                      1:1 correspondence with clean_points preserved.
        report: dict of counts, see keys below.

    Raises:
        ValueError if points and labels have mismatched lengths — cleaning
        must never run on a pair that isn't already aligned.
    """
    n = points.shape[0]
    if labels.shape[0] != n:
        raise ValueError(
            f"points has {n} rows but labels has {labels.shape[0]} — "
            f"inputs must already be point/label-aligned before cleaning."
        )

    # --- Rule 1: NaN/Inf ---
    finite_mask = np.isfinite(points).all(axis=1)
    n_nonfinite = int(n - finite_mask.sum())

    # --- Rule 2: sensor physical-range envelope ---
    # Compute range only where finite, to avoid nan/inf propagating into
    # warnings; non-finite rows are already excluded by finite_mask below
    # regardless of what their range would compute to.
    with np.errstate(invalid="ignore"):
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        r = np.sqrt(x**2 + y**2 + z**2)

    too_near_mask = finite_mask & (r < MIN_VALID_RANGE_M)
    too_far_mask = finite_mask & (r > MAX_VALID_RANGE_M)
    n_too_near = int(too_near_mask.sum())
    n_too_far = int(too_far_mask.sum())

    in_range_mask = finite_mask & (r >= MIN_VALID_RANGE_M) & (r <= MAX_VALID_RANGE_M)

    keep_mask = in_range_mask  # already implies finite_mask

    clean_points = points[keep_mask]
    clean_labels = labels[keep_mask]

    n_kept = int(keep_mask.sum())
    n_removed_total = n - n_kept

    report = {
        "input_points": n,
        "nonfinite_removed": n_nonfinite,
        "too_near_removed": n_too_near,   # range < MIN_VALID_RANGE_M (and finite)
        "too_far_removed": n_too_far,     # range > MAX_VALID_RANGE_M (and finite)
        "total_removed": n_removed_total,
        "output_points": n_kept,
        "drop_rate_pct": 100.0 * n_removed_total / n if n > 0 else 0.0,
    }
    return clean_points, clean_labels, report


def verify_correspondence(
    points: np.ndarray,
    labels: np.ndarray,
    clean_points: np.ndarray,
    clean_labels: np.ndarray,
    keep_mask: np.ndarray,
) -> bool:
    """
    Independent, brute-force proof that cleaning preserved exact
    point/label correspondence and order — re-derives the kept rows
    from the original arrays via the surviving indices and checks
    they are bit-identical to what clean_point_cloud returned.
    """
    kept_indices = np.where(keep_mask)[0]
    reconstructed_points = points[kept_indices]
    reconstructed_labels = labels[kept_indices]
    points_ok = np.array_equal(reconstructed_points, clean_points)
    labels_ok = np.array_equal(reconstructed_labels, clean_labels)
    order_ok = np.all(np.diff(kept_indices) > 0) if len(kept_indices) > 1 else True
    return bool(points_ok and labels_ok and order_ok)
