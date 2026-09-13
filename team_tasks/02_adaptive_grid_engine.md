# Member 2 — Adaptive Grid Engine Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** the core novel algorithm — converts classified 3D points into the variable-resolution 2.5D grid. This is the single most important deliverable in the whole project; it's what the problem statement is actually asking for.

---

## Your mission

Turn a labeled point cloud into a sparse, variable-resolution 2.5D grid: fine detail (5cm cells) within a 10m radius of the vehicle, coarsening out to 50cm cells at 100m — without losing height information, and without alignment errors between resolution bands.

## Why this exists (context, so you know what you're optimizing for)

- A full 3D voxel grid at 5cm resolution over a 200m×200m×5m volume needs ~1.6 billion voxels — infeasible in real time.
- A flat 2D grid is cheap but loses height, so it can't tell a flat road from a curb, pothole, or overhang.
- 2.5D is the deliberate middle ground: 2D grid cost (scales with area, not volume), but each cell also stores a height/elevation value, so safety-critical shape information survives.
- Adaptive (non-uniform) cell sizing gives you a second, independent reduction on top of that — this is your benchmarked compute/memory savings number, and it's the headline result of the whole project.

## You do NOT need to wait for Member 1's real model

Build and test against **mock labeled points** (random points with random class labels 0-5, the 6-class scheme in `shared/schemas.py`) from day one. Swap in Member 1's real classifier output later — your module's logic doesn't care where the labels came from, or how many distinct values they take.

---

## Setup — get your environment ready

```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS/Linux:            source .venv/bin/activate

pip install numpy open3d scipy pytest
pip install numba   # optional, only if profiling later shows pure-Python binning is too slow
```
Verify: `python -c "import open3d; print(open3d.__version__)"`. Open3D wheels lag behind the newest Python releases — if the install fails, check you're on a supported Python version (3.9–3.11 is the safest range) before assuming something else is wrong.

**Day-1 quick-start (do this first, today):** this module has no code yet, and everything downstream of it — the fusion node (Member 4), the dashboard (Member 5) — is blocked until it exists. Before reading further, create `grid_engine/grid_builder.py` and get *something* running end-to-end against mock data. Field names below (`range_bin`, not `ring`) match the locked wire contract in `ros2_ws/interfaces.md` v2 SS5 — use these names from day one so nobody has to rename anything at integration time:
```python
# grid_engine/grid_builder.py -- skeleton to get an unblocking version running today
import numpy as np

# (min_r, max_r, cell_size) -- placeholder edges, yours to finalize (see step 2 below).
# interfaces.md v2 suggests [0,2,5,10,20,35,55,80]m as one reasonable starting point.
RANGE_BIN_EDGES = [(0, 10, 0.05), (10, 30, 0.15), (30, 60, 0.30), (60, 100, 0.50)]

def build_grid(points_xyz, labels, confidence):
    grid = {}
    r = np.linalg.norm(points_xyz[:, :2], axis=1)
    theta = np.arctan2(points_xyz[:, 1], points_xyz[:, 0])
    for i in range(len(points_xyz)):
        if r[i] > 100:
            continue
        for range_bin, (rmin, rmax, cell_size) in enumerate(RANGE_BIN_EDGES):
            if rmin <= r[i] < rmax or (range_bin == len(RANGE_BIN_EDGES) - 1 and r[i] == rmax):
                angular_bin = int(theta[i] // (cell_size / max(r[i], 0.1)))
                key = (range_bin, angular_bin)  # Member 4's node stringifies this to "{range_bin}_{angular_bin}" before publishing
                cell = grid.setdefault(key, {"class": int(labels[i]), "height_max": points_xyz[i, 2],
                                              "height_mean": points_xyz[i, 2], "point_count": 0,
                                              "confidence": confidence[i]})
                cell["point_count"] += 1
                break
    return grid
```
This is deliberately crude (a Python loop, no real aggregation) — it exists so you have *something* to smoke-test against `shared/mock_data.py` and hand a schema-shaped output to Member 4 on day one. Replace the loop with vectorized NumPy and proper per-cell aggregation as you work through the task breakdown below; don't ship this version as your final deliverable.

---

## Task breakdown

### 1. Ground-plane fitting → height above ground
Raw `z` is sensor height, not ground-relative height. Fix that first:
```python
import open3d as o3d

def fit_ground_plane(points_xyz):
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points_xyz)
    plane_model, inliers = pcd.segment_plane(distance_threshold=0.1, ransac_n=3, num_iterations=200)
    return plane_model  # (a, b, c, d): height above ground = signed distance to this plane
```

### 2. Radial lookup table — the `range_bin` (the core trick)
Every point gets converted to polar coordinates relative to the vehicle:
```
r = sqrt(x^2 + y^2)        # planar distance from vehicle
theta = atan2(y, x)        # bearing angle
```
Then look up which **resolution band** `r` falls into from a fixed, precomputed table — this band index is what `ros2_ws/interfaces.md` v2 calls `range_bin` (an earlier draft called this "ring" and meant something else entirely — LiDAR vertical channel — so use `range_bin` in your code and docs, not "ring", to avoid resurrecting that confusion):

| range_bin | Radius range | Cell size |
|---|---|---|
| 0 | 0–10m | 5cm |
| 1 | 10–30m | 15cm |
| 2 | 30–60m | 30cm |
| 3 | 60–100m | 50cm |

The table above is a starting placeholder (4 bands) — `interfaces.md` v2 SS5 suggests an alternative 8-edge starting point (`[0,2,5,10,20,35,55,80]` meters) but explicitly leaves the exact edges, and the cell size per band, as **your call to finalize**; whichever you land on, update `shared/schemas.py`'s `RING_BOUNDARIES` (name kept for now — see that file's own note) and tell Member 3, whose clustering `eps` scales off the same bands.

Because this table is fixed, **every point maps to exactly one cell, unambiguously** — this is what avoids the "alignment errors" the problem statement explicitly warns about. Cell index = `(range_bin, floor(theta / angular_step_for_that_band))`.

### 3. Per-cell aggregation (this is what makes it "2.5D," not flat 2D)
For every point landing in a cell, update:
- point count
- max height / mean height / height variance
- dominant semantic class (majority vote, weighted by confidence)
- overall confidence

Don't just keep the last point's height per cell — aggregate across all points, or you lose exactly the information (curb height, pothole depth) that justifies going 2.5D in the first place.

### 4. Sparse storage
Use a hash map keyed by `(range_bin, angular_bin)`, not a dense array. Most of the far-field grid is empty or coarse — sparse storage is where your actual memory savings come from. On the wire (what Member 4's node actually publishes) this becomes a dict keyed by the string `"{range_bin}_{angular_bin}"` — your Python code can keep the tuple key internally, just make sure whatever wraps it for ROS 2/JSON stringifies it in that exact format.
```python
grid = {}  # (range_bin, angular_bin) -> {"class": int, "height_max": float, "height_mean": float, "count": int, "confidence": float}
```

### 5. Unit tests — edge cases matter here
- A point exactly on a range_bin boundary (r = 10.000m) — make sure it lands in exactly one band, not zero or two
- Extremely near points (r < 1m) and extremely far points (r > 100m, should be dropped or clipped)
- Angular wraparound at theta = ±180°

### 6. Benchmark: adaptive grid vs. uniform grid
Build a uniform-resolution version of the same grid (fixed 5cm cells everywhere out to 100m) and compare cell count / memory footprint against your adaptive version. **This percentage reduction is your headline number for the pitch** — don't just assert a number, produce it from an actual benchmark run.

---

## Interface contract

**You receive from Member 1:** `points (N,4)`, `labels (N,)`, `confidence (N,)`
**You deliver to Members 4 & 5:** a sparse grid structure:
```python
{
  (range_bin, angular_bin): {
    "class": int,          # 0=drivable, 1=static_obstacle_wall, 2=static_obstacle_pole, 3=dynamic_vehicle, 4=dynamic_pedestrian, 5=other_unknown
    "height_max": float,
    "height_mean": float,
    "point_count": int,
    "confidence": float,
  },
  ...
}
```
This is already locked as of `ros2_ws/interfaces.md` v2 (§5) — Member 4's node wraps your function and republishes each key as the string `"{range_bin}_{angular_bin}"`. You don't need to produce that string yourself, just keep the tuple key and the field names above exact.

## Tools
NumPy, Open3D (ground-plane fitting), optionally Numba or Cython if pure Python binning is too slow for real-time.

## Common pitfalls

- **Inconsistent boundary comparisons.** If range_bin 0 uses `r < 10` and range_bin 1 uses `r >= 10`, a point at exactly `r = 10.0` is fine — but if you write both as `<=` or mix them inconsistently across bands, a point can land in two bands or zero. Pick one convention (`rmin <= r < rmax`, with the last band closed on both ends) and apply it everywhere.
- **Angular wraparound at ±180°.** `atan2` returns values in `(-π, π]`; a naive `int(theta // angular_step)` bins correctly right up until `theta` crosses the seam, where a small change in position can jump between the first and last angular bin. Test a point at exactly `theta = 179.9°` and one at `-179.9°` and confirm they land in adjacent bins, not opposite ends of the array.
- **Overwriting a cell's height on each new point instead of aggregating.** If you assign `height_max` from only the last point processed, you've silently thrown away the "2.5D" information that's the entire point of this module. Aggregate (`max()`, running mean) across every point that lands in a cell.
- **A degenerate ground-plane fit on a near-empty or perfectly flat sample.** RANSAC can fail or return a nonsensical plane if given too few points or a pathological input (e.g. a mock frame with fewer than `ransac_n` points) — guard against this rather than letting it throw mid-pipeline.
- **Rebuilding the grid dict from scratch every call instead of reusing a preallocated structure**, if you find yourself needing to optimize for real-time later — allocation churn adds up at 10+ Hz.
- **Reporting the uniform-grid comparison from a back-of-envelope estimate instead of an actual run.** Build the naive uniform grid, run it on the same input, and diff the real cell counts — an assumed number won't survive a judge asking "how did you measure that?"

## Timeline
- **Week 1**: ground-plane fitting + radial lookup table working on mock data
- **Week 2**: per-cell aggregation + sparse storage complete, unit tests passing
- **Week 3**: benchmark vs. uniform grid, report the savings %; swap mock labels for Member 1's real model output
- **Week 4–5**: help with integration/optimization once your module is stable

## Deliverables checklist
- [ ] Ground-plane fitting working
- [ ] Radial `range_bin` lookup table with no alignment errors (edge cases tested)
- [ ] Per-cell aggregation (class + height stats + confidence)
- [ ] Sparse hash-map storage
- [ ] Unit tests for boundary cases
- [ ] Benchmark report: adaptive vs. uniform grid, memory/compute savings %
