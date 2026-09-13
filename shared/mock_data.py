"""
Shared mock LiDAR scene generator -- the canonical fake data every member
builds against until Member 1's real segmentation model is ready.

Matches schemas.py exactly: points (N,4) x,y,z,intensity; labels (N,) in
{DRIVABLE, STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE, DYNAMIC_VEHICLE,
DYNAMIC_PEDESTRIAN, OTHER_UNKNOWN, IGNORE}; confidence (N,) in [0,1].

v2 (2026-09-12): wall/pole and vehicle/pedestrian are now distinct classes
per Member 4's ros2_ws/interfaces.md v2 -- this maps directly onto the scene
primitives already used below (_wall_segment -> wall, _pole -> pole,
_vehicle -> vehicle, _pedestrian -> pedestrian), so the scene layout itself
didn't need to change, only which label constant each primitive is tagged with.

Saves in two formats:
  - .npz  : easiest for any teammate to load directly with numpy
  - KITTI : same .bin (points) / .label (labels) file layout SemanticKITTI
            uses, so a real SemanticKITTI dataloader can read this mock data
            with zero code changes -- only the source directory changes
            when you point it at the real dataset later.

Run directly to (re)generate the sample_data/ folder:
    python mock_data.py
"""
import os
import numpy as np

from schemas import (
    DRIVABLE, STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE,
    DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN, RING_BOUNDARIES,
)

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE_DIR = os.path.join(HERE, "sample_data")


# ---------------------------------------------------------------------------
# Scene primitives
# ---------------------------------------------------------------------------

def _ring_for_radius(r):
    for lo, hi, _ in RING_BOUNDARIES:
        if lo <= r < hi:
            return lo, hi
    return RING_BOUNDARIES[-1][0], RING_BOUNDARIES[-1][1]


def _density_for_radius(r, near_pts_per_m2=250.0):
    """Real LiDAR returns fall off with distance -- fewer points per m^2 far away.
    Roughly models that so the mock scene actually looks like a real scan,
    not a uniform-density toy."""
    return max(near_pts_per_m2 / max(r, 1.0) ** 1.5, 3.0)


def _ground_plane(rng, radius_m=80.0, near_pts_per_m2=40.0):
    """A gently noisy road surface out to radius_m, denser near the vehicle."""
    pts = []
    ring_step = 1.0
    r = 1.0
    while r < radius_m:
        circumference = 2 * np.pi * r
        n = max(int(circumference * _density_for_radius(r, near_pts_per_m2)), 4)
        angles = rng.uniform(0, 2 * np.pi, n)
        x = r * np.cos(angles)
        y = r * np.sin(angles)
        z = rng.normal(0.0, 0.02, n)  # road surface noise, near flat
        pts.append(np.stack([x, y, z], axis=1))
        r += ring_step
    return np.concatenate(pts, axis=0)


def _wall_segment(rng, center_xy, length=4.0, height=2.2, orientation_rad=0.0, pts_per_m2=180.0):
    n = max(int(length * height * pts_per_m2 / 20.0), 20)
    along = rng.uniform(-length / 2, length / 2, n)
    h = rng.uniform(0.0, height, n)
    x = center_xy[0] + along * np.cos(orientation_rad)
    y = center_xy[1] + along * np.sin(orientation_rad)
    return np.stack([x, y, h], axis=1)


def _pole(rng, center_xy, height=3.0, n=25):
    h = rng.uniform(0.0, height, n)
    jitter = rng.normal(0.0, 0.02, (n, 2))
    x = center_xy[0] + jitter[:, 0]
    y = center_xy[1] + jitter[:, 1]
    return np.stack([x, y, h], axis=1)


def _pedestrian(rng, center_xy, n=25):
    """Rough person-shaped point cluster: ~0.5m wide, ~1.7m tall."""
    x = rng.normal(center_xy[0], 0.15, n)
    y = rng.normal(center_xy[1], 0.15, n)
    z = rng.uniform(0.0, 1.75, n)
    return np.stack([x, y, z], axis=1)


def _vehicle(rng, center_xy, heading_rad=0.0, length=4.2, width=1.8, height=1.6, n=90):
    """Rough box-shaped point cluster approximating a car."""
    along = rng.uniform(-length / 2, length / 2, n)
    across = rng.uniform(-width / 2, width / 2, n)
    h = rng.uniform(0.0, height, n)
    x = center_xy[0] + along * np.cos(heading_rad) - across * np.sin(heading_rad)
    y = center_xy[1] + along * np.sin(heading_rad) + across * np.cos(heading_rad)
    return np.stack([x, y, h], axis=1)


# ---------------------------------------------------------------------------
# Full-scene frame generator
# ---------------------------------------------------------------------------

# Fixed scene layout so sequences are reproducible; dynamic objects move via
# `dynamic_offsets` (see generate_sequence).
WALLS = [
    ((6.0, 3.5), 5.0, 0.4),     # (center_xy, length, orientation_rad)
    ((22.0, -6.0), 8.0, 1.55),
    ((48.0, 9.0), 10.0, 0.1),
]
POLES = [
    (9.0, -2.0), (16.0, 4.5), (33.0, -5.0), (55.0, 3.0), (12.0, 6.5),
]
PEDESTRIAN_STARTS = [(11.0, 1.0), (27.0, -2.5)]
PEDESTRIAN_VELOCITY = [(0.7, 0.05), (-0.3, 0.15)]  # m/frame

VEHICLE_STARTS = [(18.0, 2.5)]
VEHICLE_VELOCITY = [(1.2, 0.0)]
VEHICLE_HEADING = [0.0]


def generate_frame(rng, t=0.0):
    """t: frame index (float). Each dynamic object advances by t * its own
    velocity -- used by generate_sequence() to produce motion across frames."""
    points_list = []
    labels_list = []

    ground = _ground_plane(rng)
    points_list.append(ground)
    labels_list.append(np.full(len(ground), DRIVABLE, dtype=np.uint8))

    for center, length, orientation in WALLS:
        pts = _wall_segment(rng, center, length=length, orientation_rad=orientation)
        points_list.append(pts)
        labels_list.append(np.full(len(pts), STATIC_OBSTACLE_WALL, dtype=np.uint8))

    for center in POLES:
        pts = _pole(rng, center)
        points_list.append(pts)
        labels_list.append(np.full(len(pts), STATIC_OBSTACLE_POLE, dtype=np.uint8))

    for start, vel in zip(PEDESTRIAN_STARTS, PEDESTRIAN_VELOCITY):
        center = (start[0] + t * vel[0], start[1] + t * vel[1])
        pts = _pedestrian(rng, center)
        points_list.append(pts)
        labels_list.append(np.full(len(pts), DYNAMIC_PEDESTRIAN, dtype=np.uint8))

    for start, vel, heading in zip(VEHICLE_STARTS, VEHICLE_VELOCITY, VEHICLE_HEADING):
        center = (start[0] + t * vel[0], start[1] + t * vel[1])
        pts = _vehicle(rng, center, heading_rad=heading)
        points_list.append(pts)
        labels_list.append(np.full(len(pts), DYNAMIC_VEHICLE, dtype=np.uint8))

    xyz = np.concatenate(points_list, axis=0).astype(np.float32)
    labels = np.concatenate(labels_list, axis=0)
    intensity = rng.uniform(0.05, 1.0, size=(xyz.shape[0], 1)).astype(np.float32)
    points = np.concatenate([xyz, intensity], axis=1)

    # confidence: high near the vehicle, a bit noisier far away -- mimics a
    # real model being more certain about nearby, denser points
    radius = np.linalg.norm(xyz[:, :2], axis=1)
    base_conf = np.clip(0.97 - radius / 250.0, 0.55, 0.97)
    confidence = np.clip(rng.normal(base_conf, 0.03), 0.4, 0.99).astype(np.float32)

    return points, labels, confidence


def generate_sequence(n_frames=20, seed=0):
    """Dynamic objects move each frame; static scene stays fixed. Returns a
    list of (points, labels, confidence) tuples, one per frame."""
    rng = np.random.default_rng(seed)
    frames = []
    for t in range(n_frames):
        frames.append(generate_frame(rng, t=float(t)))
    return frames


# ---------------------------------------------------------------------------
# Save / load helpers
# ---------------------------------------------------------------------------

def save_npz(points, labels, confidence, path):
    np.savez_compressed(path, points=points, labels=labels, confidence=confidence)


def load_npz(path):
    data = np.load(path)
    return data["points"], data["labels"], data["confidence"]


def save_kitti_format(points, labels, sequence_dir, frame_id):
    """Writes the same .bin / .label file layout SemanticKITTI uses:
      sequences/<seq>/velodyne/<frame_id>.bin  -- float32 x,y,z,intensity
      sequences/<seq>/labels/<frame_id>.label  -- uint32 per-point label

    NOTE: labels here are our already-remapped 0-5/255 scheme, not raw
    SemanticKITTI class IDs -- Member 1's real class_mapping.py step is what
    produces this remapping from the real dataset's raw labels.
    """
    velodyne_dir = os.path.join(sequence_dir, "velodyne")
    labels_dir = os.path.join(sequence_dir, "labels")
    os.makedirs(velodyne_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    fname = f"{frame_id:06d}"
    points.astype(np.float32).tofile(os.path.join(velodyne_dir, f"{fname}.bin"))
    labels.astype(np.uint32).tofile(os.path.join(labels_dir, f"{fname}.label"))


def load_kitti_format(sequence_dir, frame_id):
    fname = f"{frame_id:06d}"
    points = np.fromfile(os.path.join(sequence_dir, "velodyne", f"{fname}.bin"), dtype=np.float32).reshape(-1, 4)
    labels = np.fromfile(os.path.join(sequence_dir, "labels", f"{fname}.label"), dtype=np.uint32)
    return points, labels


# ---------------------------------------------------------------------------
# Generate the shared sample_data/ folder
# ---------------------------------------------------------------------------

def build_sample_data(n_frames=20, seed=0):
    npz_dir = os.path.join(SAMPLE_DIR, "npz_frames")
    kitti_seq_dir = os.path.join(SAMPLE_DIR, "kitti_format", "sequences", "00")
    os.makedirs(npz_dir, exist_ok=True)

    frames = generate_sequence(n_frames=n_frames, seed=seed)
    for i, (points, labels, confidence) in enumerate(frames):
        save_npz(points, labels, confidence, os.path.join(npz_dir, f"frame_{i:04d}.npz"))
        save_kitti_format(points, labels, kitti_seq_dir, frame_id=i)

    total_pts = sum(p.shape[0] for p, _, _ in frames)
    print(f"Generated {len(frames)} frames, {total_pts} total points")
    print(f"  npz frames:    {npz_dir}")
    print(f"  KITTI format:  {kitti_seq_dir}")
    return frames


if __name__ == "__main__":
    build_sample_data()
