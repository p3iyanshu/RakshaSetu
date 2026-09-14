"""
Live mock frame generator for the RakshaSetu dashboard backend.

Produces frames matching the exact data contract documented in
dashboard/README.md (and shared/schemas.py's FusedFrame/GridCell/
TrackedObject shapes), so the frontend can be built and demoed end-to-end
before the real segmentation+tracking pipeline produces
dashboard/backend/data/demo_sequence.json.

Not random noise -- a persistent little scene: a handful of static
obstacles (walls/poles) plus a few dynamic objects (pedestrians/vehicles)
that actually move frame to frame around the ego vehicle, binned into the
same adaptive polar grid (4 rings x 36 angular bins, 10 degrees/bin) the
real pipeline uses.
"""
import math
import random
from datetime import datetime, timezone

import psutil

# Class ids match shared/schemas.py's v2 6-class scheme (2026-09-12) --
# kept as plain int constants here rather than an import, since this
# generator is deliberately standalone (usable before the rest of the
# pipeline is importable at all).
DRIVABLE = 0
STATIC_WALL = 1
STATIC_POLE = 2
DYNAMIC_VEHICLE = 3
DYNAMIC_PEDESTRIAN = 4
OTHER_UNKNOWN = 5

# Deterministic ego path the generator drives itself along each tick:
# straight -> curve (a 90-degree turn) -> straight, looping back to the
# start. Dashboard-backend-only for now (not in shared/schemas.py) --
# reconciled with Member 4's real odometry later, same pattern the README
# already uses for the ring/range_bin naming mismatch.
EGO_STRAIGHT1_M = 40.0
EGO_CURVE_ARC_M = 18.0
EGO_STRAIGHT2_M = 40.0
EGO_CURVE_TURN_DEG = 90.0
EGO_LOOP_LEN_M = EGO_STRAIGHT1_M + EGO_CURVE_ARC_M + EGO_STRAIGHT2_M
EGO_BASE_SPEED_MPS = 5.0

NUM_RINGS = 4
BINS_PER_RING = 36
# (lo_m, hi_m, cell_size_m) -- same bands as shared/schemas.py RING_BOUNDARIES
RING_BOUNDARIES = [
    (0.0, 10.0, 0.05),
    (10.0, 30.0, 0.15),
    (30.0, 60.0, 0.30),
    (60.0, 100.0, 0.50),
]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _ring_for_radius(r):
    for i, (lo, hi, _) in enumerate(RING_BOUNDARIES):
        if lo <= r < hi:
            return i
    return NUM_RINGS - 1


class MockFeedGenerator:
    """Stateful generator -- call next_frame() repeatedly for a live stream."""

    def __init__(self, seed=42, dt=0.1):
        self.rng = random.Random(seed)
        self.dt = dt
        self.frame_idx = 0

        self.fps = 38.0
        self.latency = 26.0
        self.miou = 0.82
        self.savings = 62.0

        # Tracked objects: mix of static (wall/pole) and dynamic
        # (vehicle/pedestrian) so all four obstacle classes show up in the demo.
        self.objects = [
            dict(track_id=1, cls=DYNAMIC_PEDESTRIAN, radius=16.0, angle=35.0, rspeed=0.0, aspeed=18.0, is_dynamic=True),
            dict(track_id=2, cls=DYNAMIC_VEHICLE, radius=28.0, angle=-70.0, rspeed=2.4, aspeed=0.0, is_dynamic=True),
            dict(track_id=3, cls=STATIC_WALL, radius=8.5, angle=112.0, rspeed=0.0, aspeed=0.0, is_dynamic=False),
            dict(track_id=4, cls=STATIC_POLE, radius=42.0, angle=-140.0, rspeed=0.0, aspeed=0.0, is_dynamic=False),
            dict(track_id=5, cls=DYNAMIC_VEHICLE, radius=55.0, angle=162.0, rspeed=-1.5, aspeed=6.0, is_dynamic=True),
            dict(track_id=6, cls=STATIC_WALL, radius=21.0, angle=-25.0, rspeed=0.0, aspeed=0.0, is_dynamic=False),
        ]
        # extra static-obstacle cells (walls) not tied to a tracked object,
        # just to make the grid read as a real scene rather than 6 dots
        self.static_cells = [(0, 12), (1, 5), (1, 6), (1, 7), (2, 20), (2, 21), (3, 30), (3, 31)]
        # short position history per track_id for motion trails
        self.trails = {o["track_id"]: [] for o in self.objects}

        # ego vehicle's own driven pose -- see EGO_* constants above
        self.ego_dist = 0.0
        self.ego_x = 0.0
        self.ego_y = 0.0
        self.ego_heading = 0.0
        self.ego_speed = EGO_BASE_SPEED_MPS

    @property
    def meta(self):
        return {
            "source": "mock_generator",
            "checkpoint": "synthetic (no trained checkpoint loaded)",
            "num_frames": -1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _advance_objects(self):
        for o in self.objects:
            o["angle"] = (o["angle"] + o["aspeed"] * self.dt) % 360
            o["radius"] = o["radius"] + o["rspeed"] * self.dt
            if o["radius"] <= 3.0 or o["radius"] >= 95.0:
                o["rspeed"] *= -1
                o["radius"] = _clamp(o["radius"], 3.0, 95.0)

    def _advance_metrics(self):
        self.fps = _clamp(self.fps + self.rng.uniform(-1.5, 1.5), 30, 45)
        self.latency = _clamp(self.latency + self.rng.uniform(-1.5, 1.5), 20, 35)
        self.miou = _clamp(self.miou + self.rng.uniform(-0.008, 0.008), 0.60, 0.90)
        self.savings = _clamp(self.savings + self.rng.uniform(-1.0, 1.0), 55, 70)

    def _advance_ego(self):
        # Slow through the curve like a real vehicle taking a turn.
        in_curve = EGO_STRAIGHT1_M <= self.ego_dist < EGO_STRAIGHT1_M + EGO_CURVE_ARC_M
        speed = EGO_BASE_SPEED_MPS * (0.55 if in_curve else 1.0) + self.rng.uniform(-0.15, 0.15)
        speed = _clamp(speed, 0.5, EGO_BASE_SPEED_MPS)
        step = speed * self.dt

        new_dist = self.ego_dist + step
        wrapped = new_dist >= EGO_LOOP_LEN_M
        self.ego_dist = new_dist % EGO_LOOP_LEN_M

        if wrapped:
            self.ego_x = 0.0
            self.ego_y = 0.0
            self.ego_heading = 0.0
        else:
            if self.ego_dist < EGO_STRAIGHT1_M:
                heading = 0.0
            elif self.ego_dist < EGO_STRAIGHT1_M + EGO_CURVE_ARC_M:
                k = (self.ego_dist - EGO_STRAIGHT1_M) / EGO_CURVE_ARC_M
                heading = EGO_CURVE_TURN_DEG * k
            else:
                heading = EGO_CURVE_TURN_DEG
            rad = math.radians(heading)
            self.ego_x += step * math.sin(rad)
            self.ego_y += step * math.cos(rad)
            self.ego_heading = heading
        self.ego_speed = speed

    def _build_grid(self):
        occupied = {}
        for ring, b in self.static_cells:
            occupied[(ring, b)] = dict(cls=STATIC_WALL, height_max=1.9, height_mean=1.1,
                                        point_count=self.rng.randint(25, 70), confidence=0.86)
        for o in self.objects:
            ring = _ring_for_radius(o["radius"])
            b = int((o["angle"] % 360) // 10)
            h = 1.7 if o["cls"] in (DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN) else 2.1
            occupied[(ring, b)] = dict(cls=o["cls"], height_max=h, height_mean=h * 0.55,
                                        point_count=self.rng.randint(15, 55), confidence=0.8)
            # widen the footprint by one neighboring bin so objects read as
            # more than a single pixel on the grid
            nb = (ring, (b + 1) % BINS_PER_RING)
            if nb not in occupied:
                occupied[nb] = dict(cls=o["cls"], height_max=h * 0.7, height_mean=h * 0.4,
                                     point_count=self.rng.randint(8, 25), confidence=0.7)

        cells = []
        for ring in range(NUM_RINGS):
            for b in range(BINS_PER_RING):
                key = (ring, b)
                if key in occupied:
                    c = occupied[key]
                    cells.append({
                        "ring": ring, "angular_bin": b, "cls": c["cls"],
                        "height_max": round(c["height_max"], 3),
                        "height_mean": round(c["height_mean"], 3),
                        "point_count": c["point_count"],
                        "confidence": round(c["confidence"], 3),
                    })
                else:
                    hmax = round(self.rng.uniform(0.0, 0.12), 3)
                    cells.append({
                        "ring": ring, "angular_bin": b, "cls": 0,
                        "height_max": hmax,
                        "height_mean": round(hmax * 0.5, 3),
                        "point_count": self.rng.randint(4, 40),
                        "confidence": round(self.rng.uniform(0.85, 0.98), 3),
                    })
        return cells

    def _build_objects_payload(self):
        out = []
        for o in self.objects:
            rad = math.radians(o["angle"])
            x = o["radius"] * math.cos(rad)
            y = o["radius"] * math.sin(rad)
            omega = math.radians(o["aspeed"])
            vx = o["rspeed"] * math.cos(rad) - o["radius"] * omega * math.sin(rad)
            vy = o["rspeed"] * math.sin(rad) + o["radius"] * omega * math.cos(rad)

            trail = self.trails[o["track_id"]]
            trail.append([round(x, 2), round(y, 2)])
            if len(trail) > 8:
                trail.pop(0)

            out.append({
                "track_id": o["track_id"],
                "cls": o["cls"],
                "position": [round(x, 2), round(y, 2), 0.0],
                "velocity": [round(vx, 2), round(vy, 2)],
                "is_dynamic": o["is_dynamic"],
                "confidence": round(self.rng.uniform(0.75, 0.97), 3),
                "trail": list(trail),
            })
        return out

    def next_frame(self):
        self.frame_idx += 1
        self._advance_objects()
        self._advance_metrics()
        self._advance_ego()
        frame = {
            "timestamp": round(self.frame_idx * self.dt, 3),
            "grid": self._build_grid(),
            "objects": self._build_objects_payload(),
            "ego_pose": {
                "x": round(self.ego_x, 2),
                "y": round(self.ego_y, 2),
                "heading_deg": round(self.ego_heading, 2),
                "speed_mps": round(self.ego_speed, 2),
            },
            "metrics": {
                "fps": round(self.fps, 1),
                "latency_ms": round(self.latency, 1),
                "miou": round(self.miou, 3),
                "compute_savings_pct": round(self.savings, 1),
                # real process RSS, not a grid-memory-savings claim -- swap
                # in a real adaptive-vs-uniform grid comparison later if the
                # grid engine exposes one.
                "memory_mb": round(psutil.Process().memory_info().rss / 1e6, 1),
            },
        }
        return frame
