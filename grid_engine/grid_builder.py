"""
Adaptive variable-resolution 2.5D grid engine (Member 2).

Converts classified 3D LiDAR points into a sparse, polar (range_bin,
angular_bin)-indexed grid: fine cells near the ego vehicle, coarse cells far
away, with per-cell height/class/confidence aggregation. This is the module
that turns "labeled point cloud" into the "adaptive 2.5D map" the problem
statement asks for -- see team_tasks/02_adaptive_grid_engine.md for the full
brief and ros2_ws/interfaces.md SS5 for the wire contract this mirrors.

Public API:
    fit_ground_plane(points_xyz)              -> (a, b, c, d) plane model
    height_above_ground(points_xyz, plane)     -> (N,) float array
    build_adaptive_grid(points, labels, confidence, ground_plane=None) -> dict
    build_uniform_grid(points, labels, confidence, ground_plane=None)  -> dict

Import RANGE_BIN_EDGES from here (mirrored into shared/schemas.py's
RING_BOUNDARIES) -- never hand-duplicate the band table elsewhere.

Each cell carries class/height_max/height_mean/point_count/confidence (the
fields locked in ros2_ws/interfaces.md SS5) plus height_variance -- an
addition beyond that base contract (population variance, ddof=0, so a
single-point cell gets 0 rather than NaN); flag this to Member 4 before
relying on it in ros2_ws/interfaces.md's wire format.
"""
import numpy as np

# ---------------------------------------------------------------------------
# Radial resolution bands -- the core "adaptive variable-resolution" trick.
#
# Finalized from the [0,2,5,10,20,35,55,80]m starting point suggested in
# ros2_ws/interfaces.md v2 SS5, extended to 100m to match the mission's
# explicit outer bound. Cell size stays at 5cm out to 10m (the "fine detail
# within a 10m radius" requirement spans bands 0-2), then grows smoothly to
# 50cm at the 100m edge. Mirrored in shared/schemas.py as RING_BOUNDARIES --
# update both places together, and tell Member 3 (tracking/clustering.py's
# DBSCAN eps scales off RING_BOUNDARIES automatically, so it picks up any
# change here once schemas.py is updated to match).
RANGE_BIN_EDGES = [
    (0.0, 2.0, 0.05),
    (2.0, 5.0, 0.05),
    (5.0, 10.0, 0.05),
    (10.0, 20.0, 0.15),
    (20.0, 35.0, 0.25),
    (35.0, 55.0, 0.35),
    (55.0, 80.0, 0.45),
    (80.0, 100.0, 0.50),
]

# The uniform-grid comparator for the benchmark (Task 6): the same polar
# scheme, but a single band holding the finest cell size (5cm) all the way
# out to 100m -- i.e. "fixed 5cm cells everywhere out to 100m", binned with
# the exact same machinery as the adaptive grid so the comparison is apples
# to apples (same points, same aggregation, only the band table differs).
UNIFORM_BIN_EDGES = [(0.0, 100.0, 0.05)]

_MAX_ANGULAR_BINS_PER_BAND = 1_000_000  # key-encoding multiplier, see _build_grid


def fit_ground_plane(points_xyz, distance_threshold=0.1, ransac_n=3, num_iterations=200):
    """RANSAC-fits the ground plane; returns (a, b, c, d) such that
    height above ground = signed distance to this plane.

    Guards against the degenerate case (too few points, or open3d/RANSAC
    failing on a pathological frame) by falling back to a flat z=0 ground
    plane rather than throwing mid-pipeline.
    """
    if points_xyz.shape[0] < ransac_n:
        return (0.0, 0.0, 1.0, 0.0)
    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(np.asarray(points_xyz, dtype=np.float64))
        plane_model, _inliers = pcd.segment_plane(
            distance_threshold=distance_threshold, ransac_n=ransac_n, num_iterations=num_iterations
        )
        a, b, c, d = plane_model
        if not np.isfinite([a, b, c, d]).all() or (a == 0 and b == 0 and c == 0):
            return (0.0, 0.0, 1.0, 0.0)
        return (float(a), float(b), float(c), float(d))
    except Exception:
        return (0.0, 0.0, 1.0, 0.0)


def height_above_ground(points_xyz, plane_model):
    """Signed distance from each point to the ground plane (a,b,c,d)."""
    a, b, c, d = plane_model
    norm = np.sqrt(a * a + b * b + c * c)
    if norm == 0:
        return points_xyz[:, 2].copy()
    return (a * points_xyz[:, 0] + b * points_xyz[:, 1] + c * points_xyz[:, 2] + d) / norm


def _angular_bin_counts(edges):
    """Fixed number of angular bins per band, sized off the band's OUTER
    radius so the arc length (r * dtheta) never exceeds the band's target
    cell size -- using the inner radius instead would make the outer edge of
    every band coarser than intended. Fixed (not per-point) angular_step per
    band is what keeps every point's bin unambiguous -- the day-1 skeleton's
    per-point `cell_size / r` step let two points in the same band at
    different radii disagree on bin boundaries, which is exactly the
    "alignment error" the problem statement warns about.
    """
    counts = []
    for _rmin, rmax, cell_size in edges:
        n = max(1, int(round(2 * np.pi * rmax / cell_size)))
        counts.append(n)
    return np.array(counts, dtype=np.int64)


def _range_bin_lookup(r, edges):
    """rmin <= r < rmax per band, with the last band closed on both ends.
    Returns (range_bin, valid_mask) -- valid_mask excludes r < 0 or beyond
    the outermost edge (dropped/clipped per the module's edge-case rules)."""
    boundaries = np.array([e[0] for e in edges] + [edges[-1][1]])
    max_r = boundaries[-1]
    valid = (r >= 0.0) & (r <= max_r)
    idx = np.searchsorted(boundaries, r, side="right") - 1
    idx = np.clip(idx, 0, len(edges) - 1)
    return idx, valid


def _angular_bin_lookup(theta, range_bin, n_angular_bins):
    """theta from atan2 is in (-pi, pi]; shifting to [0, 2*pi) moves the
    array's wrap seam to straight-ahead (theta=0) instead of directly behind
    the vehicle (theta=+-pi) -- so a point crossing the physical +-180 deg
    seam lands in two ADJACENT bins either side of the new seam, rather than
    jumping to opposite ends of the array. The final mod guards the exact
    theta_shifted == 2*pi floating-point edge.
    """
    theta_shifted = np.mod(theta, 2 * np.pi)
    step = (2 * np.pi) / n_angular_bins[range_bin]
    bins = np.floor(theta_shifted / step).astype(np.int64)
    return np.mod(bins, n_angular_bins[range_bin])


def _build_grid(points, labels, confidence, edges, ground_plane=None):
    points = np.asarray(points)
    labels = np.asarray(labels)
    confidence = np.asarray(confidence)
    xyz = points[:, :3]

    if ground_plane is None:
        ground_plane = fit_ground_plane(xyz)
    height = height_above_ground(xyz, ground_plane)

    r = np.linalg.norm(xyz[:, :2], axis=1)
    theta = np.arctan2(xyz[:, 1], xyz[:, 0])

    range_bin, valid = _range_bin_lookup(r, edges)
    if not np.any(valid):
        return {}

    range_bin = range_bin[valid]
    theta = theta[valid]
    height = height[valid]
    labels_v = labels[valid]
    confidence_v = confidence[valid]

    n_angular_bins = _angular_bin_counts(edges)
    angular_bin = _angular_bin_lookup(theta, range_bin, n_angular_bins)

    if n_angular_bins.max() >= _MAX_ANGULAR_BINS_PER_BAND:
        raise ValueError("angular bin count exceeds the key-encoding multiplier; raise _MAX_ANGULAR_BINS_PER_BAND")
    combined_key = range_bin.astype(np.int64) * _MAX_ANGULAR_BINS_PER_BAND + angular_bin

    unique_keys, inverse, counts = np.unique(combined_key, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    n_groups = unique_keys.shape[0]

    height_max = np.full(n_groups, -np.inf)
    np.maximum.at(height_max, inverse, height)

    height_sum = np.zeros(n_groups)
    np.add.at(height_sum, inverse, height)
    height_mean = height_sum / counts

    height_sq_sum = np.zeros(n_groups)
    np.add.at(height_sq_sum, inverse, height * height)
    # Population variance (ddof=0): sensible default when a cell can hold a
    # single point (sample variance, ddof=1, would be undefined there).
    # max(...,0) guards a tiny negative from floating-point cancellation.
    height_variance = np.maximum(height_sq_sum / counts - height_mean * height_mean, 0.0)

    confidence_sum = np.zeros(n_groups)
    np.add.at(confidence_sum, inverse, confidence_v)
    confidence_mean = confidence_sum / counts

    n_classes = 6
    class_weight = np.zeros((n_groups, n_classes))
    np.add.at(class_weight, (inverse, labels_v.astype(np.int64)), confidence_v)
    dominant_class = np.argmax(class_weight, axis=1)

    grid = {}
    decoded_range_bin = unique_keys // _MAX_ANGULAR_BINS_PER_BAND
    decoded_angular_bin = unique_keys % _MAX_ANGULAR_BINS_PER_BAND
    for g in range(n_groups):
        key = (int(decoded_range_bin[g]), int(decoded_angular_bin[g]))
        grid[key] = {
            "class": int(dominant_class[g]),
            "height_max": float(height_max[g]),
            "height_mean": float(height_mean[g]),
            "height_variance": float(height_variance[g]),
            "point_count": int(counts[g]),
            "confidence": float(confidence_mean[g]),
        }
    return grid


def build_adaptive_grid(points, labels, confidence, ground_plane=None):
    """points (N,4) x,y,z,intensity; labels (N,); confidence (N,) -- see
    ros2_ws/interfaces.md SS5. Returns dict[(range_bin, angular_bin) -> cell].
    """
    return _build_grid(points, labels, confidence, RANGE_BIN_EDGES, ground_plane)


def build_uniform_grid(points, labels, confidence, ground_plane=None):
    """Same inputs/output shape as build_adaptive_grid, but with a single
    fixed 5cm cell size everywhere out to 100m -- the baseline Task 6
    benchmarks the adaptive grid against."""
    return _build_grid(points, labels, confidence, UNIFORM_BIN_EDGES, ground_plane)


# Backwards-compatible alias for the day-1 unblocking skeleton's name.
build_grid = build_adaptive_grid
