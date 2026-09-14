"""
Unit tests for grid_engine/grid_builder.py -- see the "Common pitfalls" and
"Unit tests" sections of team_tasks/02_adaptive_grid_engine.md for why each
of these specifically matters (alignment errors, wraparound, aggregation
overwrite bugs, degenerate RANSAC input).

Run with: pytest grid_engine/tests/test_grid_builder.py -v
"""
import numpy as np
import pytest

from grid_builder import (
    RANGE_BIN_EDGES,
    _angular_bin_counts,
    _angular_bin_lookup,
    _range_bin_lookup,
    build_adaptive_grid,
    build_uniform_grid,
    fit_ground_plane,
    height_above_ground,
)

FLAT_GROUND = (0.0, 0.0, 1.0, 0.0)


def _point(x, y, z, intensity=0.5):
    return np.array([[x, y, z, intensity]], dtype=np.float64)


# ---------------------------------------------------------------------------
# range_bin boundaries -- must be unambiguous (no point in zero or two bands)
# ---------------------------------------------------------------------------

def test_interior_boundary_lands_in_exactly_one_band():
    # 10.0m is the edge between band 2 (5-10m) and band 3 (10-20m).
    r = np.array([10.0])
    range_bin, valid = _range_bin_lookup(r, RANGE_BIN_EDGES)
    assert valid[0]
    assert range_bin[0] == 3  # rmin <= r < rmax -> belongs to the band it opens, not the one it closes


def test_outer_boundary_is_closed_on_both_ends():
    r = np.array([100.0])  # the very last edge
    range_bin, valid = _range_bin_lookup(r, RANGE_BIN_EDGES)
    assert valid[0]
    assert range_bin[0] == len(RANGE_BIN_EDGES) - 1


def test_beyond_max_range_is_dropped():
    points = np.vstack([_point(150.0, 0.0, 0.0), _point(1.0, 0.0, 0.0)])
    labels = np.array([0, 0])
    confidence = np.array([0.9, 0.9])
    grid = build_adaptive_grid(points, labels, confidence, ground_plane=FLAT_GROUND)
    total_points = sum(c["point_count"] for c in grid.values())
    assert total_points == 1  # the far point never makes it into any cell


def test_near_origin_point_does_not_crash():
    points = _point(0.0, 0.0, 0.0)
    labels = np.array([0])
    confidence = np.array([0.9])
    grid = build_adaptive_grid(points, labels, confidence, ground_plane=FLAT_GROUND)
    assert len(grid) == 1
    ((range_bin, _angular_bin), cell) = next(iter(grid.items()))
    assert range_bin == 0
    assert cell["point_count"] == 1


# ---------------------------------------------------------------------------
# Angular wraparound at +-180 deg
# ---------------------------------------------------------------------------

def test_angular_wraparound_lands_in_adjacent_bins():
    r = 50.0
    theta_pos = np.radians(179.9)
    theta_neg = np.radians(-179.9)
    range_bin = np.array([5, 5])  # both points share the same radius/band
    n_angular_bins = _angular_bin_counts(RANGE_BIN_EDGES)

    bins = _angular_bin_lookup(np.array([theta_pos, theta_neg]), range_bin, n_angular_bins)
    n = n_angular_bins[5]
    diff = abs(int(bins[0]) - int(bins[1]))
    circular_diff = min(diff, n - diff)
    assert circular_diff <= 1  # adjacent (or same bin), never opposite ends of the array


def test_wraparound_points_are_not_split_to_array_ends():
    # A naive `int(theta // step)` bins -pi..~0 and 0..~pi into opposite ends
    # of the array (index 0 vs index n-1). Confirm that's NOT what happens.
    n_angular_bins = _angular_bin_counts(RANGE_BIN_EDGES)
    range_bin = np.array([5, 5])
    bins = _angular_bin_lookup(
        np.array([np.radians(179.9), np.radians(-179.9)]), range_bin, n_angular_bins
    )
    n = n_angular_bins[5]
    assert not ({int(bins[0]), int(bins[1])} == {0, n - 1})


# ---------------------------------------------------------------------------
# Per-cell aggregation -- must aggregate across points, not overwrite
# ---------------------------------------------------------------------------

def test_aggregation_across_multiple_points_in_one_cell():
    # All three points share (x, y) so they are guaranteed to land in the
    # same cell; only z, class, and confidence differ.
    points = np.vstack([
        _point(1.0, 0.0, 0.10),
        _point(1.0, 0.0, 0.30),
        _point(1.0, 0.0, 0.05),
    ])
    labels = np.array([0, 0, 1])
    confidence = np.array([0.9, 0.05, 0.8])

    grid = build_adaptive_grid(points, labels, confidence, ground_plane=FLAT_GROUND)
    assert len(grid) == 1
    cell = next(iter(grid.values()))

    assert cell["point_count"] == 3
    assert cell["height_max"] == pytest.approx(0.30)
    assert cell["height_mean"] == pytest.approx((0.10 + 0.30 + 0.05) / 3)
    assert cell["class"] == 0  # weighted vote: class 0 gets 0.9+0.05=0.95 > class 1's 0.8
    assert cell["confidence"] == pytest.approx((0.9 + 0.05 + 0.8) / 3)


def test_distinct_cells_stay_separate():
    points = np.vstack([_point(1.0, 0.0, 0.0), _point(40.0, 0.0, 0.0)])
    labels = np.array([0, 0])
    confidence = np.array([0.9, 0.9])
    grid = build_adaptive_grid(points, labels, confidence, ground_plane=FLAT_GROUND)
    assert len(grid) == 2
    assert isinstance(grid, dict)


# ---------------------------------------------------------------------------
# Ground-plane fitting -- guard the degenerate case
# ---------------------------------------------------------------------------

def test_ground_plane_fit_handles_too_few_points():
    for n in (0, 1, 2):
        xyz = np.zeros((n, 3))
        plane = fit_ground_plane(xyz)
        assert len(plane) == 4
        assert np.isfinite(plane).all()


def test_height_above_ground_matches_z_for_flat_plane():
    xyz = np.array([[1.0, 2.0, 0.42], [5.0, -1.0, -0.1]])
    height = height_above_ground(xyz, FLAT_GROUND)
    np.testing.assert_allclose(height, xyz[:, 2])


# ---------------------------------------------------------------------------
# Sparse storage + the adaptive-vs-uniform benchmark, on the real mock scene
# ---------------------------------------------------------------------------

def test_grid_engine_output_matches_schema(mock_frame):
    points, labels, confidence = mock_frame
    grid = build_adaptive_grid(points, labels, confidence)
    assert isinstance(grid, dict)
    for (range_bin, angular_bin), cell in grid.items():
        assert isinstance(range_bin, int) and isinstance(angular_bin, int)
        assert set(cell.keys()) == {"class", "height_max", "height_mean", "point_count", "confidence"}
        assert cell["class"] in (0, 1, 2, 3, 4, 5)
        assert cell["point_count"] > 0
        assert 0.0 <= cell["confidence"] <= 1.0


def test_adaptive_grid_uses_fewer_cells_than_uniform(mock_frame):
    points, labels, confidence = mock_frame
    adaptive_grid = build_adaptive_grid(points, labels, confidence)
    uniform_grid = build_uniform_grid(points, labels, confidence)
    assert len(adaptive_grid) < len(uniform_grid)


@pytest.fixture
def mock_frame():
    import os
    from mock_data import load_npz

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(root, "shared", "sample_data", "npz_frames", "frame_0000.npz")
    return load_npz(path)
