# Grid Engine (Member 2)

Converts classified 3D LiDAR points into a sparse, variable-resolution 2.5D
grid: fine cells near the ego vehicle, coarse cells far away, each carrying
height/class/confidence, not just occupancy. Implements
`team_tasks/02_adaptive_grid_engine.md`; mirrors `ros2_ws/interfaces.md` SS5.

## Usage

```python
from grid_engine.grid_builder import build_adaptive_grid

grid = build_adaptive_grid(points, labels, confidence)
# grid: dict[(range_bin, angular_bin)] -> {
#   "class": int, "height_max": float, "height_mean": float,
#   "height_variance": float, "point_count": int, "confidence": float,
# }
```

`height_variance` (population variance, ddof=0, of point heights in the
cell) is an addition beyond the 5 fields locked in `ros2_ws/interfaces.md`
SS5 — flagged there for Member 4 to confirm before it goes into the actual
ROS 2/JSON wire message.

`points` is `(N, 4)` `[x, y, z, intensity]`; `labels` and `confidence` are
`(N,)`. Pass a precomputed `ground_plane=(a, b, c, d)` to skip the RANSAC fit
(e.g. when reusing one plane across a batch, or in tests).

## Design

- **Radial bands (`RANGE_BIN_EDGES`)** — 8 bands from 0 to 100m, 5cm cells
  out to 10m, growing to 50cm at 100m. Finalized from the `[0,2,5,10,20,
  35,55,80]`m starting point `ros2_ws/interfaces.md` v2 SS5 suggested,
  extended to 100m. Mirrored in `shared/schemas.py`'s `RING_BOUNDARIES` —
  update both together. `tracking/clustering.py` imports `RING_BOUNDARIES`
  directly, so its DBSCAN `eps` picks up any change automatically.
- **Fixed angular step per band, not per point.** Each band gets one
  `angular_step`, sized off the band's *outer* radius so no cell within the
  band exceeds its target size. A per-point step (arc length ÷ that point's
  own radius) would let two points in the same band at different radii
  disagree about where bin boundaries fall — the exact "alignment error"
  the problem statement warns about.
- **Wraparound handled by shifting the seam.** `atan2` is discontinuous at
  ±180°. Shifting `theta` into `[0, 2π)` before binning moves that seam to
  straight-ahead (0°) instead of directly behind the vehicle, so points near
  ±180° land in adjacent bins instead of opposite ends of the array.
- **Aggregation, not overwrite.** Every point in a cell contributes to
  `point_count`, running max/mean/variance height, and a confidence-weighted
  class vote — dropping any of those loses the "2.5D" information (curb
  height, pothole depth) that's the entire point of not going flat 2D.
  `height_variance` in particular flags cells with mixed heights (e.g. a
  curb edge, half road half wall) that `height_mean` alone would hide.
- **Sparse dict, keyed by `(range_bin, angular_bin)`.** Only occupied cells
  are stored; this is where the actual memory savings come from, especially
  once you're aggregating a mostly-empty far field into large coarse cells.
- **Ground-plane fit is guarded.** `fit_ground_plane` falls back to a flat
  `z=0` plane rather than throwing when handed fewer than 3 points (or if
  Open3D's RANSAC otherwise fails) — a degenerate/near-empty mock frame
  should degrade gracefully, not crash the pipeline.
- **Vectorized.** No per-point Python loop; binning and aggregation are
  NumPy array ops (`np.unique`, `np.add.at`, `np.maximum.at`) grouped by an
  encoded `(range_bin, angular_bin)` key.

## Benchmark: adaptive vs. uniform grid

`build_uniform_grid` reuses the exact same binning/aggregation machinery
with a single band (fixed 5cm cells, 0–100m) — an apples-to-apples baseline,
not a different implementation. `benchmark.py` runs both against the 20-frame
shared mock sequence:

```
python grid_engine/benchmark.py
```

Actual run (20 frames, ~1.2M total points):

| | Uniform (5cm, 0–100m) | Adaptive (8-band) |
|---|---|---|
| Occupied cells | 249,258 | 95,969 |
| Build time | 57.8 ms/frame | 43.2 ms/frame |

**61.5% fewer occupied cells**, and faster to build — far-field points that
would each claim their own tiny uniform cell get aggregated into far fewer,
larger adaptive cells. This is the headline savings number for the pitch;
re-run `benchmark.py` if `RANGE_BIN_EDGES` changes.

## Tests

```
pytest grid_engine/tests/test_grid_builder.py -v
```

Covers: exact-boundary range values (no point in zero or two bands), the
outer-edge closed-both-ends case, out-of-range points being dropped,
±180° angular wraparound, multi-point aggregation correctness, degenerate
ground-plane input, and adaptive-vs-uniform cell count on the real mock
scene. `tests/test_contracts.py::test_grid_engine_output_matches_schema` is
the shared contract test proving the output matches `ros2_ws/interfaces.md`
SS5 exactly.

## Known limitations / next steps

- `classify()` output (Member 1) hasn't been wired in yet — still tested
  against `shared/mock_data.py`'s random-but-realistic scene. Swapping in
  real labels needs no code change here; the function signature doesn't
  care where `labels`/`confidence` came from.
- `fit_ground_plane` is called once per frame; if profiling later shows
  RANSAC dominating frame time, consider caching the plane across a few
  frames (the ground doesn't move fast relative to the vehicle) or reducing
  `num_iterations`.
- Aggregation currently rebuilds the grid dict from scratch every call
  (`np.unique` over all points each frame). Fine at mock-data scale; if
  real-time profiling later shows allocation churn, a preallocated/reused
  structure is the next optimization, not a correctness concern.
