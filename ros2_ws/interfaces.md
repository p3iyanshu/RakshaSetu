# RakshaSetu — Pipeline Interface Contract (`interfaces.md`)

**Owner:** Member 4 (Systems Integration)
**Status:** v2 — supersedes v1. If you started building against v1, read the changelog at the bottom before you continue; three of the four changes affect message shape, not just wording.
**Purpose:** This is the exact shape of data each stage of the pipeline sends and receives. Build your module's output to match this exactly — if something here doesn't fit how your module naturally works, tell me before Week 2 starts, not after you've built around a different shape.

---

## Conventions used everywhere below

- **Coordinate frame:** ego-vehicle frame, ROS standard (REP-103) — x = forward, y = left, z = up. All positions/velocities are in this frame unless stated otherwise.
- **Units:** distances in meters, velocities in meters/second, angles in radians, timestamps as ROS 2 `Time` (seconds + nanoseconds since epoch).
- **confidence:** always a float in `[0.0, 1.0]`, never a raw/unnormalized score.
- **Every message includes a `timestamp` and `frame_id`** — this is what lets `message_filters` line up messages from different nodes that describe the same instant. Do not omit these even if your own module doesn't use them internally.

---

## 1. LidarIngest → raw points

**Published by:** `lidar_ingest_node.py`
**Topic:** `/rakshasetu/lidar/points`

| Field | Type | Description |
|---|---|---|
| `points` | float32 array, shape `(N, 4)` | Each row: `[x, y, z, intensity]` |
| `timestamp` | ROS 2 Time | Capture time of this frame |
| `frame_id` | string | Sensor/ego frame identifier |

```json
{
  "points": [[12.4, 0.8, -1.2, 0.63], [12.5, 0.9, -1.2, 0.58], "... N rows total"],
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

**N is not fixed** — it varies per frame depending on the scene. Downstream nodes must not assume a constant N.

---

## 2. Preprocessing → filtered/downsampled points

**Published by:** `preprocessing_node.py`
**Topic:** `/rakshasetu/lidar/points_preprocessed`
**Input:** consumes `/rakshasetu/lidar/points` (raw, from LidarIngest)

**This is the topic Segmentation actually consumes — not the raw `/rakshasetu/lidar/points` topic.** v1 of this document named the raw topic in Segmentation's input line while also describing it as "post-preprocessing," which was contradictory. Fixed here by giving preprocessing its own explicit topic.

| Field | Type | Description |
|---|---|---|
| `points` | float32 array, shape `(M, 4)` | Same shape as LidarIngest's points — `[x, y, z, intensity]` per row — after ground filtering and downsampling |
| `timestamp` | ROS 2 Time | **Must match** the timestamp of the raw LidarIngest message it was computed from |
| `frame_id` | string | Same as input |

**M ≤ N** — preprocessing only removes points (ground plane, downsampling), never adds them. M varies per frame just like N.

---

## 3. EgoOdometry → the vehicle's own motion

**Published by:** `ego_odometry_node.py` (stub for now — republishes CARLA's real vehicle odometry once `carla-ros-bridge` is wired in, per Week 1 Day 5-7)
**Topic:** `/rakshasetu/ego/odometry`

**Why this exists:** Tracking needs to know how fast the ego vehicle itself is moving to correctly compute whether a *detected* object is actually moving in the real world, or only appears to move because the vehicle it's being observed from is moving. See section 6 (Tracking) for how this gets used — this section just defines where that data comes from.

| Field | Type | Description |
|---|---|---|
| `linear_velocity` | `[vx, vy, vz]` float32 | Ego vehicle's own velocity, ego frame, m/s |
| `angular_velocity` | `[wx, wy, wz]` float32 | Ego vehicle's own angular velocity, rad/s |
| `timestamp` | ROS 2 Time | Capture time |
| `frame_id` | string | Same as other topics |

```json
{
  "linear_velocity": [8.2, 0.0, 0.0],
  "angular_velocity": [0.0, 0.0, 0.05],
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

Until the CARLA bridge is live, this stub publishes a constant near-zero value — meaning the ego-motion compensation described in section 6 is effectively a no-op for now, which is fine for proving the pipeline runs, but means tracked velocities from the current stub should **not** be read as physically meaningful yet.

---

## 4. Segmentation → per-point labels (Member 1)

**Published by:** `segmentation_node.py` (wraps Member 1's `classify()` function)
**Topic:** `/rakshasetu/segmentation/labels`
**Input:** consumes `/rakshasetu/lidar/points_preprocessed` (section 2 above, not raw points)

| Field | Type | Description |
|---|---|---|
| `labels` | int array, shape `(N,)` | One class ID per input point, **same N and same point order** as the input points message it corresponds to |
| `confidence` | float32 array, shape `(N,)` | Per-point confidence, same order as `labels` |
| `timestamp` | ROS 2 Time | **Must match** the timestamp of the input points message it was computed from |
| `frame_id` | string | Same as input |

**Class ID mapping (locked — do not renumber without telling everyone):**
```
0 = drivable_terrain
1 = static_obstacle_wall
2 = static_obstacle_pole
3 = dynamic_vehicle
4 = dynamic_pedestrian
5 = other / unknown
```

```json
{
  "labels": [0, 0, 3, 4, "... N total"],
  "confidence": [0.98, 0.95, 0.87, 0.94, "... N total"],
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

**Critical rule:** `labels[i]` and `confidence[i]` must describe the same point as `points[i]` in the corresponding LidarIngest message — order must be preserved, not resorted or filtered, unless you also publish an `indices` array mapping back to the original points. If your model drops/filters points internally, tell me — we'll add an `indices` field rather than assume.

---

## 5. GridEngine → sparse 2.5D occupancy grid (Member 2)

**Published by:** `grid_engine_node.py` (wraps Member 2's grid-building function)
**Topic:** `/rakshasetu/grid/occupancy`
**Input:** consumes segmented points (points + labels + confidence, same frame)

**Corrected in v2 — this was wrong in v1.** v1 defined the grid key as `(ring, angular_bin)` where `ring` meant "the LiDAR's vertical channel index." That's a real LiDAR concept (which physical scan layer a point came from), but it is **not** what our adaptive-resolution 2.5D grid should be indexed by — vertical channel has nothing to do with ground-plane position, and a grid cell should represent a location on the ground (range + angle from the vehicle), aggregating points from *any* channel that happen to land there. Using vertical channel as the key would have produced a grid that doesn't correspond to physical space at all — it needed catching before Member 2 built against it.

**Corrected definition — the grid is a top-down (bird's-eye) map, indexed by ground-plane position:**

| Field | Type | Description |
|---|---|---|
| `grid` | dict, keyed by `"{range_bin}_{angular_bin}"` string | Sparse — only occupied cells are present |
| `timestamp` | ROS 2 Time | Matches the segmentation frame it was built from |
| `frame_id` | string | Same as input |

Each grid cell value is an object:

| Sub-field | Type | Description |
|---|---|---|
| `class` | int | Dominant class ID in this cell (same mapping as Segmentation) |
| `height_max` | float32 | Max point height (z) in this cell — this is the "0.5" in "2.5D": a 2D ground-plane grid with height carried per cell, not a full 3D voxel grid |
| `height_mean` | float32 | Mean point height in this cell |
| `point_count` | int | Number of points falling in this cell |
| `confidence` | float32 | Aggregated confidence for this cell |

**Key definition:**
- **`range_bin`** — index of a distance band measured radially outward from the ego vehicle (i.e., from `sqrt(x² + y²)`), **not** the sensor's vertical channel. This is where the "adaptive variable-resolution" idea actually lives: band widths should get wider with distance (fine resolution close to the vehicle, coarser further out — the "foveated" concept from the problem statement). A reasonable starting set of band edges (in meters) is `[0, 2, 5, 10, 20, 35, 55, 80]` — `range_bin 0` covers 0-2m, `range_bin 1` covers 2-5m, etc. **Member 2 owns the exact edge values** as part of the adaptive-resolution design — this contract only fixes that range is what's being binned, not the specific thresholds.
- **`angular_bin`** — discretized horizontal azimuth angle around the vehicle, computed from `atan2(y, x)`. A reasonable starting resolution is 180 bins (2° each) across the full 360°, or restricted to a forward field of view if that's sufficient for the demo — confirm with the team which.

```json
{
  "grid": {
    "2_88": {"class": 0, "height_max": 0.12, "height_mean": 0.05, "point_count": 41, "confidence": 0.97},
    "2_89": {"class": 1, "height_max": 2.1, "height_mean": 1.4, "point_count": 18, "confidence": 0.89}
  },
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

If Member 2's implementation uses a fundamentally different indexing scheme (e.g., Cartesian x/y cells instead of range/angular), tell me before building — Fusion needs to know the exact convention to correctly map tracked objects onto grid cells (see section 7 below).

---

## 6. Tracking → tracked dynamic objects (Member 3)

**Published by:** `tracking_node.py` (wraps Member 3's clustering + tracking function)
**Topic:** `/rakshasetu/tracking/objects`
**Input:** consumes segmented points (focused on dynamic classes 3, 4 in the class mapping above) **and** `/rakshasetu/ego/odometry` (section 3) — both are required inputs now, not just the points.

**Corrected in v2 — this was ambiguous and actually wrong in v1.** v1 defined a single `velocity` field as "estimated velocity, ego frame," without addressing an important subtlety: since the ego vehicle itself is moving, an object's *apparent* motion as directly observed from the vehicle includes the vehicle's own motion mixed in. A parked car would appear to have significant velocity in the raw ego frame purely because the vehicle we're observing it from is moving past it — using that raw number for `is_dynamic` would misclassify plenty of stationary objects as moving. Fixed by splitting this into two explicit fields and using ego odometry (section 3) to compute the corrected one.

| Field | Type | Description |
|---|---|---|
| `objects` | list of object dicts | One entry per currently tracked object |
| `timestamp` | ROS 2 Time | Matches the frame it was computed from |
| `frame_id` | string | Same as input |

Each object in the list:

| Sub-field | Type | Description |
|---|---|---|
| `track_id` | int | Stable ID — **must stay the same** for the same physical object across consecutive frames, this is what makes it "tracking" and not just "detection" |
| `class` | int | Same class mapping as Segmentation |
| `position` | `[x, y, z]` float32 | Object centroid, ego frame |
| `velocity` | `[vx, vy, vz]` float32 | **Ego-motion-compensated velocity** — the object's real-world velocity, with the ego vehicle's own motion (from EgoOdometry) subtracted out. **This is the field `is_dynamic` must be derived from**, and the one downstream consumers (Fusion, dashboard, any future prediction logic) should treat as "true" velocity. |
| `velocity_relative` | `[vx, vy, vz]` float32 | Raw apparent velocity as directly observed in the moving ego frame, **before** compensation — kept only for debugging/visualization, never for decision logic. Will look large even for stationary objects whenever the ego vehicle itself is moving fast. |
| `is_dynamic` | bool | True if the object's **compensated** (`velocity`, not `velocity_relative`) speed is above a small threshold |
| `confidence` | float32 | Tracking confidence |

```json
{
  "objects": [
    {"track_id": 17, "class": 4, "position": [8.2, 1.1, 0.0], "velocity": [0.0, -1.3, 0.0], "velocity_relative": [-8.2, -1.3, 0.0], "is_dynamic": true, "confidence": 0.94},
    {"track_id": 22, "class": 3, "position": [21.7, -3.4, 0.0], "velocity": [0.0, 0.0, 0.0], "velocity_relative": [-8.2, 0.0, 0.0], "is_dynamic": false, "confidence": 0.97}
  ],
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

(Illustrative example above: ego vehicle moving forward at 8.2 m/s. Object 17 is a pedestrian genuinely walking — compensated velocity is small and real. Object 22 is a parked car — its large `velocity_relative` is purely the ego vehicle's own motion; once compensated, `velocity` correctly comes out near zero and `is_dynamic` is correctly `false`.)

**Critical rule:** `track_id` continuity is the whole point of this module — if the tracker loses and re-detects the same object, it should try to keep the same ID rather than issuing a new one, otherwise downstream velocity/trajectory logic breaks silently.

**Until the CARLA bridge is live (section 3), EgoOdometry publishes near-zero values, so `velocity` and `velocity_relative` will look identical in the current stub** — the compensation logic itself should still be built and wired now so it's already correct once real ego motion is flowing in.

---

## 7. Fusion → final combined output (Member 4 / mine)

**Published by:** `fusion_node.py`
**Topic:** `/rakshasetu/fusion/output` — streamed onward to Member 5's dashboard over WebSocket

**Corrected in v2.** v1 described Fusion as pure packaging — grid and objects placed side by side in one message, untouched. That's fine only if the two layers never need to be cross-referenced. They do: the dashboard (and any real "is this grid cell currently occupied by a moving object" logic) needs to know *which* grid cell each tracked object is sitting in. Two independent lists with no link between them can't answer that — so Fusion now does real reconciliation, not just packaging.

| Field | Type | Description |
|---|---|---|
| `grid` | same shape as GridEngine's `grid`, **with an added optional field per cell** (see below) | The static/terrain layer, annotated with dynamic overlay info |
| `objects` | same shape as Tracking's `objects`, **with two added fields per object** (see below) | The dynamic layer |
| `timestamp` | ROS 2 Time | Combined frame timestamp |
| `frame_id` | string | Same as input |

**What Fusion actually computes (this is real logic, not a pass-through):**

1. For every tracked object, compute which grid cell its `position` falls into, using the **exact same range/angular binning as GridEngine** (section 5) — this produces two new fields added onto each object:
   - `grid_range_bin` (int)
   - `grid_angular_bin` (int)

   This means any consumer can directly look up `grid["{grid_range_bin}_{grid_angular_bin}"]` for a given object without recomputing anything themselves.

2. For every grid cell that has at least one tracked object mapped onto it (from step 1), add an optional field to that cell:
   - `dynamic_track_id` (int) — the `track_id` of the object currently occupying this cell. Cells with no object on them simply don't have this field, same sparse-dict convention as the rest of the grid.

```json
{
  "grid": {
    "2_88": {"class": 0, "height_max": 0.12, "height_mean": 0.05, "point_count": 41, "confidence": 0.97},
    "4_90": {"class": 3, "height_max": 1.6, "height_mean": 0.9, "point_count": 22, "confidence": 0.88, "dynamic_track_id": 17}
  },
  "objects": [
    {"track_id": 17, "class": 4, "position": [8.2, 1.1, 0.0], "velocity": [0.0, -1.3, 0.0], "velocity_relative": [-8.2, -1.3, 0.0], "is_dynamic": true, "confidence": 0.94, "grid_range_bin": 4, "grid_angular_bin": 90}
  ],
  "timestamp": "1735900000.123456789",
  "frame_id": "ego_lidar"
}
```

Members 1-3 don't need to build anything against this schema — it's downstream of your work, documented here for Member 5's reference and so everyone understands what the dashboard is actually receiving.

---

## What to do if your module doesn't naturally fit this shape

Don't silently reshape your output to force a fit, and don't silently build something different and hope it works at integration time. Message me directly — we adjust the contract deliberately, once, and I re-share the update with everyone, rather than each node drifting independently.

## Change log

- **v1 (Day 1-2, Week 1):** initial contract.
- **v2 (Day 2-3, Week 1):** four corrections found during team review, before any real module was built against v1:
  1. Added a missing, explicit **Preprocessing** section (`/rakshasetu/lidar/points_preprocessed`) — v1 had Segmentation's input line contradicting the raw-points topic definition.
  2. **Redefined the GridEngine key** from `(vertical LiDAR channel, angular_bin)` to `(range_bin, angular_bin)` — a genuine ground-plane radial grid, which is what "adaptive variable-resolution 2.5D mapping" actually requires. The v1 definition would have produced a grid with no real spatial meaning.
  3. **Fusion now performs real reconciliation** (mapping each tracked object to its grid cell, tagging occupied cells) instead of blindly packaging grid + objects side by side with no link between them.
  4. **Split Tracking's velocity into `velocity` (ego-motion-compensated) and `velocity_relative` (raw)**, and added the new `EgoOdometry` topic/section needed to do that compensation — v1's single ego-frame velocity field would have misclassified stationary objects as moving whenever the vehicle itself was in motion.
