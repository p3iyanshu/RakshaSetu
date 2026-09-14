# Shared Interfaces & Handoff Process

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Read this file before starting your individual task file.** This is the single source of truth for the data formats passed between modules, and the process for handing off your finished work to the rest of the team. Owned/maintained by Member 4 (Systems Integration), but everyone must follow it.

---

## Part 1 — The Interface Contract

Every member's module is judged by one thing: does it accept and produce data in **exactly** this shape? If yes, integration is close to plug-and-play. If everyone quietly assumes their own format, integration week becomes a debugging nightmare instead of a demo.

Put this file in the repo at `shared/schemas.py` and **import from it — never redefine these shapes locally.**

**v2 (2026-09-12):** the full topic-level contract now lives in [`ros2_ws/interfaces.md`](../ros2_ws/interfaces.md) (Member 4, v2) — it documents every ROS 2 topic, JSON wire shape, and the reasoning behind each field. What follows below is the Python-side mirror of that contract as it exists in `shared/schemas.py` today. **If this ever looks out of sync with the actual `shared/schemas.py` file or with `ros2_ws/interfaces.md`, the code file and `ros2_ws/interfaces.md` win — update this copy to match, don't trust this copy over them.** (This exact staleness — this file quoting the old 3-class scheme after the code had already moved to 6 — is what happened between v1 and v2; keeping a second hand-copied version of a contract is exactly the kind of drift Part 1's own rule warns against.)

```python
# shared/schemas.py — the single source of truth. Import this, don't redefine these shapes.

from dataclasses import dataclass

# ---- Stage 1: Raw ingest (Member 4's lidar_ingest_node) ----
# points: np.ndarray, shape (N, 4) -> columns: x, y, z, intensity

DRIVABLE = 0
STATIC_OBSTACLE_WALL = 1
STATIC_OBSTACLE_POLE = 2
DYNAMIC_VEHICLE = 3
DYNAMIC_PEDESTRIAN = 4
OTHER_UNKNOWN = 5
IGNORE = 255   # training-time-only sentinel -- classify() never emits this at inference

# ---- Stage 2: Segmentation output (Member 1 -> Members 2, 3) ----
@dataclass
class SegmentationOutput:
    labels: "np.ndarray"        # shape (N,), values in {0,1,2,3,4,5} at inference
    confidence: "np.ndarray"    # shape (N,), float in [0.0, 1.0]

# ---- Stage 3: Grid Engine output (Member 2 -> Member 4) ----
# Indexed by ground-plane position (range_bin, angular_bin) -- NOT LiDAR
# vertical channel (a v1 mistake, corrected in interfaces.md v2). String key
# "{range_bin}_{angular_bin}" on the wire.
@dataclass
class GridCell:
    range_bin: int               # radial distance band index from the ego vehicle
    angular_bin: int
    cls: int                     # dominant class, same 6-class mapping as Segmentation
    height_max: float
    height_mean: float
    point_count: int
    confidence: float
    dynamic_track_id: int = None # set only by Fusion, for cells a tracked object occupies

# Full grid = dict[(range_bin, angular_bin), GridCell]

# ---- Stage 4: Tracking output (Member 3 -> Member 4) ----
# v2 adds ego-motion compensation -- see EgoOdometry below and
# ros2_ws/interfaces.md SS6 for why `velocity` and `velocity_relative` are
# two separate fields, not one.
@dataclass
class EgoOdometry:
    linear_velocity: tuple     # (vx, vy, vz), ego frame, m/s
    angular_velocity: tuple    # (wx, wy, wz), rad/s

@dataclass
class TrackedObject:
    track_id: int
    cls: int                      # same 6-class mapping as Segmentation (typically 1-5)
    position: tuple                 # (x, y, z)
    velocity: tuple                  # (vx, vy, vz) -- EGO-MOTION-COMPENSATED. is_dynamic is derived from this, never velocity_relative.
    velocity_relative: tuple          # (vx, vy, vz) -- RAW, before compensation. Debugging/visualization only.
    is_dynamic: bool
    confidence: float
    grid_range_bin: int = None          # set only by Fusion
    grid_angular_bin: int = None        # set only by Fusion

# ---- Stage 5: Fusion output (Member 4 -> Member 5's dashboard) ----
# v2: Fusion does real reconciliation (mapping each object onto its grid
# cell) rather than packaging grid + objects as two unlinked lists.
@dataclass
class FusedFrame:
    timestamp: float
    grid: list                  # list[GridCell]
    objects: list                # list[TrackedObject]
    metrics: dict                 # {"fps": float, "latency_ms": float, "miou": float, "compute_savings_pct": float}
```

**Rule: nobody changes a field name, type, or shape here without telling everyone who consumes it, first.** If you need to change the contract, post it in the team chat, get explicit agreement from every affected member, update `ros2_ws/interfaces.md` and `shared/schemas.py`, *then* change your code — never the other way around.

---

## Part 2 — How to hand off your finished module to the team

### 1. Repo structure — everyone owns their own folder
```
rakshasetu/
├── shared/schemas.py         # this contract — Member 4 maintains it, everyone reads it
├── data/                     # Member 1
├── models/                   # Member 1
├── grid_engine/              # Member 2
├── tracking/                 # Member 3
├── ros2_ws/                  # Member 4
├── dashboard/                # Member 5
├── security/                 # Member 6
└── tests/test_contracts.py   # shared contract tests — Member 4 maintains, everyone adds a case
```

### 2. Git workflow
- `main` = always-working code only. Nobody commits directly to it.
- Each member works on their own branch: `feature/segmentation-model`, `feature/grid-engine`, `feature/tracking`, `feature/ros2-integration`, `feature/dashboard`, `feature/security-optimization`.
- Commit early and often on your own branch — there's no penalty for messy commits there.

### 3. Before you open a Pull Request — prove your module matches the contract
Add a test case to `tests/test_contracts.py` that feeds your function the agreed mock input (matching Part 1's schema) and asserts the output matches the expected schema — shape, types, field names, value ranges. This is a five-minute test that saves hours of integration debugging.

```python
# example: Member 2 adding their contract test
def test_grid_engine_output_matches_schema(mock_segmented_points):
    grid = build_adaptive_grid(mock_segmented_points)
    for cell in grid.values():
        assert set(cell.keys()) == {"class", "height_max", "height_mean", "point_count", "confidence"}
        assert cell["class"] in (0, 1, 2)
```

Run it locally: `pytest tests/test_contracts.py::test_grid_engine_output_matches_schema` — must pass before you open a PR.

### 4. Open a Pull Request
- PR title: `[YourModule] short description`
- PR description must include:
  - What changed
  - Which stage of the contract it implements (reference Part 1)
  - Sample input → sample output (a short code snippet or a link to your test fixture)
  - Confirmation that your contract test passes
- Tag **Member 4** as reviewer (they own integration and need to see every module that touches the pipeline)
- Merge only after review approval — don't self-merge into `main`

### 5. Announce it in the team chat
When your PR is merged, post a short message tagging whoever consumes your output directly:
- Member 1 → tags Members 2 & 3 ("segmentation model merged, classify() is live in `models/`")
- Members 2 & 3 → tag Member 4
- Member 4 → tags Member 5
- Member 6's security/optimization work → tags whoever owns the piece being hardened

Use this handoff template:
```
Module: <name>
Branch merged: feature/<name>
Function signature: <exact signature>
Sample input/output: <link to test fixture or snippet>
Contract test: PASSING
Known limitations: <anything the next person should know>
```

### 6. Live integration sessions (don't do these async)
At the two big checkpoints — end of Week 3 (pairwise integration) and Week 4 (full pipeline) — get on a call or sit together, pull everyone's latest merged work into an `integration` branch, and run the full pipeline together. Fixing a mismatch live, with both people who wrote the two sides of it, takes minutes. Discovering the same mismatch separately, days apart, over chat, takes hours.

### 7. If something breaks the contract after merging
Don't quietly patch around it in your own module. Flag it in the team chat immediately, agree on the fix with whoever else is affected, update `shared/schemas.py` if the contract itself needs to change, and only then patch the code — in that order.

---

## Summary — the one rule that matters most

Everyone can work in parallel, starting day one, as long as they build against the schemas in Part 1 (using mock data where needed) instead of waiting for a teammate's real implementation. The moment someone changes a shape without telling the people downstream of them is the moment the last week turns into firefighting instead of polish. Protect that rule above all else.
