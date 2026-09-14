"""
Support module for validate_semantic_kitti.py (Task 5).

Real SemanticKITTI velodyne scans are given in the LiDAR sensor frame at
each instant, not a fixed world frame. Because the ego vehicle itself is
moving, a perfectly static wall's sensor-frame (x, y) position keeps
changing from one scan to the next -- at roughly the vehicle's own speed,
which easily swamps the tracker's dynamic-vs-static velocity threshold and
makes every static structure look "dynamic". Real, is_dynamic() needs a
stabilized reference frame to be meaningful.

This module ego-motion-compensates raw scans using SemanticKITTI's provided
ground-truth poses (poses.txt) and the sequence's calibration (calib.txt),
so `validate_semantic_kitti.py` can check the tracker's decision logic in
isolation from ego motion -- the same way published moving-object-detection
methods evaluate against SemanticKITTI (see e.g. LMNet/4DMOS, which also
transform scans into a common frame using these poses before comparing).

NOTE for integration (Member 4): the tracking module itself does not do
this -- it trusts that incoming point clouds are already in a stabilized
frame. The live pipeline will need real vehicle odometry/localization
feeding an equivalent compensation step upstream of tracking; that's not
part of today's interface contract (shared/schemas.py) and should be
raised with Member 4 before integration.
"""
import numpy as np


def load_calib_tr(calib_path):
    """Reads calib.txt, returns the 4x4 velodyne-to-cam0 transform (the
    `Tr:` line, KITTI's standard 3x4 extrinsic + implicit [0,0,0,1] row)."""
    with open(calib_path) as f:
        for line in f:
            if line.startswith("Tr:"):
                vals = np.array([float(v) for v in line.split()[1:]], dtype=np.float64)
                Tr = np.eye(4)
                Tr[:3, :4] = vals.reshape(3, 4)
                return Tr
    raise ValueError(f"no Tr: line found in {calib_path}")


def load_poses(poses_path):
    """Reads poses.txt, returns a list of 4x4 cam0-to-world transforms, one
    per frame (world frame = the sequence's own frame-0 cam0 frame)."""
    poses = []
    with open(poses_path) as f:
        for line in f:
            vals = np.array([float(v) for v in line.split()], dtype=np.float64)
            T = np.eye(4)
            T[:3, :4] = vals.reshape(3, 4)
            poses.append(T)
    return poses


def load_times(times_path):
    """Reads times.txt, returns per-frame timestamps in seconds (float),
    relative to the start of the sequence."""
    with open(times_path) as f:
        return np.array([float(line) for line in f if line.strip()], dtype=np.float64)


class EgoMotionCompensator:
    """world_from_velo(t) = cam0_from_world(t)^-1-composed pose chain: since
    poses.txt already gives world_from_cam0(t), and Tr gives cam0_from_velo,
    world_from_velo(t) = world_from_cam0(t) @ cam0_from_velo."""

    def __init__(self, calib_path, poses_path, times_path=None):
        self.Tr = load_calib_tr(calib_path)
        self.poses = load_poses(poses_path)
        self.times = load_times(times_path) if times_path else None

    def world_from_velo(self, frame_id):
        return self.poses[frame_id] @ self.Tr

    def to_world(self, points_xyz, frame_id):
        """points_xyz: (N, 3) in the velodyne sensor frame at `frame_id`.
        Returns (N, 3) in the sequence's fixed world frame."""
        T = self.world_from_velo(frame_id)
        homogeneous = np.concatenate([points_xyz, np.ones((points_xyz.shape[0], 1))], axis=1)
        world = homogeneous @ T.T
        return world[:, :3]

    def dt(self, frame_id_a, frame_id_b):
        if self.times is None:
            return float(frame_id_b - frame_id_a)
        return float(self.times[frame_id_b] - self.times[frame_id_a])
