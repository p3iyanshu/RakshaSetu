"""
Task 3 & 4 from team_tasks/03_clustering_and_tracking.md

A constant-velocity Kalman filter per tracked object, SORT-style
frame-to-frame data association (centroid-distance cost + Hungarian
algorithm), and the multi-frame static/dynamic decision.

Consumes the per-cluster feature dicts produced by clustering.py
(`extract_cluster_features`) and produces objects matching
shared/schemas.py's TrackedObject shape.

v2 (2026-09-12): ego-motion compensation, per Member 4's
ros2_ws/interfaces.md v2 SS6. The Kalman filter measures a cluster's
centroid in whatever frame it's given -- if that's the live ego/sensor
frame (as it will be from Member 4's ROS 2 node), the filter's own velocity
estimate is the RAW apparent velocity (`velocity_relative`), which includes
the ego vehicle's own motion mixed in: a parked car looks like it's moving
purely because the vehicle observing it is moving. `MultiObjectTracker.update()`
now takes an optional `ego_velocity` (from Member 4's new EgoOdometry topic)
and adds it to the raw estimate to recover the object's true, world-frame
velocity (`velocity`) -- `is_dynamic` is decided from this compensated
value, never the raw one. Defaults to `(0.0, 0.0)`, which is exactly correct
for callers that already hand this module pre-compensated, world-frame
centroids (e.g. validate_semantic_kitti.py, which transforms centroids into
the sequence's world frame via ego_motion.py *before* calling `.update()`)
-- for those callers, `velocity` and `velocity_relative` come out identical,
which is the correct degenerate case, not a bug.
"""
import os
import sys
from collections import deque

import numpy as np
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared"))
from schemas import STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE

# wall/pole are static *by definition* -- SemanticKITTI (and interfaces.md's
# class scheme) has no "moving-building"/"moving-fence"/"moving-pole"
# equivalent, so ground truth for these classes is always static. A nonzero
# measured velocity on a wall/pole track is therefore guaranteed to be noise
# (partial-visibility centroid drift, DBSCAN fragment instability on
# building-scale clusters -- see validate_semantic_kitti.py's findings),
# never a real detection. Deciding from velocity for these classes can only
# ever produce false positives, so skip that decision entirely.
INHERENTLY_STATIC_CLASSES = (STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE)


class KalmanTrack:
    """Constant-velocity Kalman filter for one object, state = [x, y, vx, vy].

    Position (x, y) is measured each frame from the matched cluster's
    centroid; velocity is never observed directly, only inferred by the
    filter from consecutive position updates.
    """

    _next_id = 1

    def __init__(self, centroid, cls, confidence, dt=1.0,
                 process_var=1.0, measurement_var=0.25, history_maxlen=20):
        self.track_id = KalmanTrack._next_id
        KalmanTrack._next_id += 1

        self.dt = dt
        x, y, z = centroid
        self.state = np.array([x, y, 0.0, 0.0])  # [x, y, vx, vy]
        # Large initial velocity uncertainty: first observation carries no
        # velocity information yet.
        self.P = np.diag([measurement_var, measurement_var, 10.0, 10.0])

        self.F = np.array([
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ])
        q = process_var
        self.Q = np.array([
            [dt**4/4, 0, dt**3/2, 0],
            [0, dt**4/4, 0, dt**3/2],
            [dt**3/2, 0, dt**2, 0],
            [0, dt**3/2, 0, dt**2],
        ]) * q
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]])
        self.R = np.eye(2) * measurement_var

        self.z = z  # height is not part of the KF state, just carried over
        self.cls = cls
        self.confidence = confidence
        self.last_cluster_id = None  # which of this frame's input clusters matched, if any

        self.hits = 1
        self.age = 0
        self.time_since_update = 0
        # Rolling window of post-update velocity estimates, used by the
        # static/dynamic decision. Bounded so long-lived tracks don't grow
        # memory unboundedly and so the decision can adapt if a stopped
        # object starts moving (or vice versa). A newly-detected object's
        # measured centroid is biased for its first several frames (LiDAR
        # coverage of it is still sparse/partial at first, especially at
        # range -- validated against real SemanticKITTI data, see
        # validate_semantic_kitti.py), so the window needs enough headroom
        # past min_frames_for_decision for that early bias to age out.
        #
        # velocity_history: raw Kalman-estimated velocity in whatever frame
        # centroids were given in (== velocity_relative going forward).
        # compensated_velocity_history: the same, with that frame's
        # ego_velocity added back in (== velocity going forward) -- this is
        # what is_dynamic() must use.
        self.velocity_history = deque(maxlen=history_maxlen)
        self.compensated_velocity_history = deque(maxlen=history_maxlen)

    def predict(self):
        self.state = self.F @ self.state
        self.P = self.F @ self.P @ self.F.T + self.Q
        self.age += 1
        self.time_since_update += 1
        return self.state[:2]

    def update(self, centroid, cls, confidence, cluster_id=None, ego_velocity=(0.0, 0.0)):
        x, y, z = centroid
        measurement = np.array([x, y])

        y_residual = measurement - self.H @ self.state
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)

        self.state = self.state + K @ y_residual
        self.P = (np.eye(4) - K @ self.H) @ self.P

        self.z = z
        self.cls = cls
        self.confidence = confidence
        self.last_cluster_id = cluster_id
        self.hits += 1
        self.time_since_update = 0
        self.velocity_history.append(self.state[2:4].copy())
        self.compensated_velocity_history.append(self.state[2:4] + np.asarray(ego_velocity, dtype=np.float64))

    @property
    def position(self):
        return (float(self.state[0]), float(self.state[1]), float(self.z))

    @property
    def velocity(self):
        """Ego-motion-COMPENSATED velocity (vx, vy, vz) -- the object's
        best-estimate true velocity, with the ego vehicle's own motion
        subtracted back out. This is what `is_dynamic` is derived from.
        vz is always 0.0 -- the Kalman state only tracks ground-plane (x,y)
        velocity."""
        if self.compensated_velocity_history:
            vx, vy = self.compensated_velocity_history[-1]
        else:
            vx, vy = self.state[2], self.state[3]  # no ego_velocity observed yet -- same as raw
        return (float(vx), float(vy), 0.0)

    @property
    def velocity_relative(self):
        """RAW apparent velocity (vx, vy, vz), before ego-motion compensation.
        Debugging/visualization only -- never use this for is_dynamic or any
        decision logic; it looks large for a stationary object whenever the
        ego vehicle itself is moving."""
        return (float(self.state[2]), float(self.state[3]), 0.0)

    def is_dynamic(self, velocity_threshold=0.3, min_frames=10):
        """False immediately (never None, never velocity-derived) for
        INHERENTLY_STATIC_CLASSES -- wall/pole have no real "moving" category
        to begin with, so any measured velocity for one is definitionally
        noise. Otherwise: None until enough consistent frames have been
        observed -- a stationary object can show small apparent motion from
        sensor/cluster noise on a single frame, so we don't decide on one frame.

        Averages the COMPENSATED velocity *vector* over the window (never
        the raw/relative one -- see module docstring), and over the vector
        itself, not the per-frame speed. A static object whose measured
        centroid jitters around (e.g. because a different slice of it is
        visible to the LiDAR each frame) still reads a nonzero instantaneous
        speed on every single frame; if that jitter has no consistent
        direction it cancels out in the vector average, leaving ~0 net
        speed. mean(|v_i|) would instead accumulate that noise into a false
        "average speed" that never cancels.
        """
        if self.cls in INHERENTLY_STATIC_CLASSES:
            return False
        if len(self.compensated_velocity_history) < min_frames:
            return None
        mean_velocity = np.mean(self.compensated_velocity_history, axis=0)
        return bool(np.linalg.norm(mean_velocity) > velocity_threshold)

    def to_tracked_object(self, velocity_threshold=0.3, min_frames=10):
        dynamic = self.is_dynamic(velocity_threshold, min_frames)
        return {
            "track_id": self.track_id,
            "cls": self.cls,
            "position": self.position,
            "velocity": self.velocity,
            "velocity_relative": self.velocity_relative,
            "is_dynamic": bool(dynamic) if dynamic is not None else False,
            "confidence": self.confidence,
        }


class MultiObjectTracker:
    """SORT-style tracker: predict every track, associate this frame's
    clusters to tracks by centroid distance + Hungarian assignment, update
    matches, spawn new tracks for unmatched detections, age out unmatched
    tracks."""

    def __init__(self, dt=1.0, max_match_distance=3.0, max_age=5, min_hits=3,
                 velocity_threshold=0.3, min_frames_for_decision=10, history_maxlen=20):
        self.dt = dt
        self.max_match_distance = max_match_distance
        self.max_age = max_age
        self.min_hits = min_hits
        self.velocity_threshold = velocity_threshold
        self.min_frames_for_decision = min_frames_for_decision
        self.history_maxlen = history_maxlen
        self.tracks = []

    def _associate(self, detections):
        if not self.tracks or not detections:
            return [], list(range(len(self.tracks))), list(range(len(detections)))

        track_pos = np.array([t.state[:2] for t in self.tracks])
        det_pos = np.array([d["centroid"][:2] for d in detections])
        cost_matrix = np.linalg.norm(
            track_pos[:, None, :] - det_pos[None, :, :], axis=2
        )

        row_ind, col_ind = linear_sum_assignment(cost_matrix)

        matches, unmatched_tracks, unmatched_dets = [], [], []
        matched_tracks, matched_dets = set(), set()
        for r, c in zip(row_ind, col_ind):
            if cost_matrix[r, c] <= self.max_match_distance:
                matches.append((r, c))
                matched_tracks.add(r)
                matched_dets.add(c)

        unmatched_tracks = [i for i in range(len(self.tracks)) if i not in matched_tracks]
        unmatched_dets = [i for i in range(len(detections)) if i not in matched_dets]
        return matches, unmatched_tracks, unmatched_dets

    def update(self, clusters, ego_velocity=(0.0, 0.0)):
        """clusters: list of per-cluster feature dicts from
        clustering.extract_cluster_features (must have 'centroid',
        'dominant_class', 'mean_confidence').

        ego_velocity: (vx, vy) of the ego vehicle itself this frame, ground
        plane, same frame the cluster centroids are measured in -- from
        Member 4's EgoOdometry topic. Defaults to (0.0, 0.0), which is
        correct both for a genuinely stationary/no-odometry case and for
        callers that already hand this module pre-compensated, world-frame
        centroids (see module docstring).

        Returns the list of currently-confirmed tracked objects, matching
        shared/schemas.py's TrackedObject shape.
        """
        for t in self.tracks:
            t.predict()
            t.last_cluster_id = None  # cleared each frame; set again below if matched

        matches, unmatched_tracks, unmatched_dets = self._associate(clusters)

        for r, c in matches:
            det = clusters[c]
            self.tracks[r].update(det["centroid"], det["dominant_class"], det["mean_confidence"],
                                   det["cluster_id"], ego_velocity=ego_velocity)

        for c in unmatched_dets:
            det = clusters[c]
            new_track = KalmanTrack(
                det["centroid"], det["dominant_class"], det["mean_confidence"], dt=self.dt,
                history_maxlen=self.history_maxlen,
            )
            new_track.last_cluster_id = det["cluster_id"]
            self.tracks.append(new_track)

        self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_age]

        return [
            t.to_tracked_object(self.velocity_threshold, self.min_frames_for_decision)
            for t in self.tracks
            if t.hits >= self.min_hits or t.time_since_update == 0
        ]


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "../shared")
    from mock_data import load_npz
    from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES

    tracker = MultiObjectTracker()
    for i in range(20):
        points, labels, confidence = load_npz(f"../shared/sample_data/npz_frames/frame_{i:04d}.npz")
        obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)
        xyz = points[obstacle_mask, :3]
        obs_labels = labels[obstacle_mask]
        obs_confidence = confidence[obstacle_mask]

        cluster_ids = cluster_obstacles(xyz, obs_labels)
        clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)
        # no live EgoOdometry in this offline demo -- ego_velocity defaults to
        # (0.0, 0.0), so velocity == velocity_relative here (see module docstring)
        objects = tracker.update(clusters)

        print(f"frame {i}: {len(clusters)} clusters -> {len(objects)} confirmed tracks")
        for obj in objects:
            speed = np.linalg.norm(obj["velocity"])
            dyn = "dynamic" if obj["is_dynamic"] else "static"
            print(f"  track {obj['track_id']}: cls={obj['cls']} pos={obj['position']} "
                  f"speed={speed:.2f} -> {dyn}")
