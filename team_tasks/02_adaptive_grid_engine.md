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

Build and test against **mock labeled points** (random points with random class labels 0/1/2) from day one. Swap in Member 1's real classifier output later — your module's logic doesn't care where the labels came from.

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

### 2. Radial-ring lookup table (the core trick)
Every point gets converted to polar coordinates relative to the vehicle:
```
r = sqrt(x^2 + y^2)        # planar distance from vehicle
theta = atan2(y, x)        # bearing angle
```
Then look up which **resolution ring** `r` falls into from a fixed, precomputed table:

| Ring | Radius range | Cell size |
|---|---|---|
| 0 | 0–10m | 5cm |
| 1 | 10–30m | 15cm |
| 2 | 30–60m | 30cm |
| 3 | 60–100m | 50cm |

Because this table is fixed, **every point maps to exactly one cell, unambiguously** — this is what avoids the "alignment errors" the problem statement explicitly warns about. Cell index within a ring = `(ring_index, floor(theta / angular_step_for_that_ring))`.

### 3. Per-cell aggregation (this is what makes it "2.5D," not flat 2D)
For every point landing in a cell, update:
- point count
- max height / mean height / height variance
- dominant semantic class (majority vote, weighted by confidence)
- overall confidence

Don't just keep the last point's height per cell — aggregate across all points, or you lose exactly the information (curb height, pothole depth) that justifies going 2.5D in the first place.

### 4. Sparse storage
Use a hash map keyed by `(ring, angular_bin)`, not a dense array. Most of the far-field grid is empty or coarse — sparse storage is where your actual memory savings come from.
```python
grid = {}  # (ring, angular_bin) -> {"class": int, "height_max": float, "height_mean": float, "count": int, "confidence": float}
```

### 5. Unit tests — edge cases matter here
- A point exactly on a ring boundary (r = 10.000m) — make sure it lands in exactly one ring, not zero or two
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
  (ring, angular_bin): {
    "class": int,          # 0=drivable, 1=static_obstacle, 2=dynamic_object
    "height_max": float,
    "height_mean": float,
    "point_count": int,
    "confidence": float,
  },
  ...
}
```
Confirm this exact schema with Member 4 in week 1 — they'll wrap your function as a ROS 2 node and need the field names locked.

## Tools
NumPy, Open3D (ground-plane fitting), optionally Numba or Cython if pure Python binning is too slow for real-time.

## Timeline
- **Week 1**: ground-plane fitting + radial lookup table working on mock data
- **Week 2**: per-cell aggregation + sparse storage complete, unit tests passing
- **Week 3**: benchmark vs. uniform grid, report the savings %; swap mock labels for Member 1's real model output
- **Week 4–5**: help with integration/optimization once your module is stable

## Deliverables checklist
- [ ] Ground-plane fitting working
- [ ] Radial-ring lookup table with no alignment errors (edge cases tested)
- [ ] Per-cell aggregation (class + height stats + confidence)
- [ ] Sparse hash-map storage
- [ ] Unit tests for boundary cases
- [ ] Benchmark report: adaptive vs. uniform grid, memory/compute savings %
