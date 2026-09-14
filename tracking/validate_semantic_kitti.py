"""
Task 5 from team_tasks/03_clustering_and_tracking.md

Runs the real clustering + tracking pipeline over a real SemanticKITTI
sequence and checks the tracker's multi-frame static/dynamic decision
against SemanticKITTI's built-in `moving-X` vs `X` ground truth, instead of
only eyeballing it on mock data.

Ground truth is per-point (a point is "moving" if its raw label is one of
the moving-X ids). We turn that into a per-track ground truth by majority
vote: a cluster/track is "ground-truth dynamic" if most of its points carry
a moving-X label in that frame.

Usage:
    python validate_semantic_kitti.py [sequence_dir] [n_frames]

Data isn't checked into the repo (see .gitignore) -- extract a frame range
from the official data_odometry_velodyne.zip / data_odometry_labels.zip
first, e.g.:
    tracking/kitti_validation_data/sequences/00/{velodyne,labels}/*
"""
import os
import sys

import numpy as np

from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES
from ego_motion import EgoMotionCompensator
from kalman_tracker import MultiObjectTracker
from semantic_kitti_labels import load_label_file, load_velodyne_file, to_simplified_labels, to_moving_mask

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SEQ_DIR = os.path.join(HERE, "kitti_validation_data", "sequences", "00")


def load_frame(seq_dir, frame_id):
    fname = f"{frame_id:06d}"
    points = load_velodyne_file(os.path.join(seq_dir, "velodyne", f"{fname}.bin"))
    semantic_id, _instance_id = load_label_file(os.path.join(seq_dir, "labels", f"{fname}.label"))
    return points, semantic_id


def run_validation(seq_dir, n_frames=None, velocity_threshold=0.3, min_frames=10,
                    compensate_ego_motion=True, verbose=True):
    fnames = sorted(f for f in os.listdir(os.path.join(seq_dir, "labels")) if f.endswith(".label"))
    frame_ids = [int(f[:-6]) for f in fnames]
    if n_frames is not None:
        frame_ids = frame_ids[:n_frames]

    ego = None
    calib_path = os.path.join(seq_dir, "calib.txt")
    poses_path = os.path.join(seq_dir, "poses.txt")
    times_path = os.path.join(seq_dir, "times.txt")
    if compensate_ego_motion and os.path.exists(calib_path) and os.path.exists(poses_path):
        ego = EgoMotionCompensator(calib_path, poses_path, times_path if os.path.exists(times_path) else None)
        dt = ego.dt(frame_ids[0], frame_ids[1]) if len(frame_ids) > 1 else 1.0
    else:
        if verbose:
            print("No calib.txt/poses.txt found -- running WITHOUT ego-motion compensation. "
                  "Every static structure will look dynamic because the vehicle itself is moving "
                  "through the scene each frame; see ego_motion.py for why this matters.")
        dt = 1.0

    tracker = MultiObjectTracker(dt=dt, velocity_threshold=velocity_threshold, min_frames_for_decision=min_frames)

    # Confusion counts, evaluated only once a track has enough history to
    # produce a decision at all (is_dynamic() returns None before that).
    tp = fp = tn = fn = 0
    n_evaluated_frames = 0

    for frame_id in frame_ids:
        points, semantic_id = load_frame(seq_dir, frame_id)
        simplified_labels = to_simplified_labels(semantic_id)
        moving_mask = to_moving_mask(semantic_id)

        obstacle_mask = np.isin(simplified_labels, OBSTACLE_CLASSES)
        xyz = points[obstacle_mask, :3].astype(np.float64)  # sensor frame -- ring eps depends on this being true range
        obs_labels = simplified_labels[obstacle_mask]
        obs_confidence = np.ones(obs_labels.shape[0], dtype=np.float32)  # real data has no model confidence
        obs_moving = moving_mask[obstacle_mask]

        # Cluster in the native sensor frame: cluster_obstacles scales eps by
        # each point's actual distance from the sensor (points are sparser
        # far away), which only means what it's supposed to mean if radius
        # is measured from the sensor, not from some fixed world origin.
        cluster_ids = cluster_obstacles(xyz, obs_labels)
        clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)

        # Only *after* clustering, move each cluster's centroid into the
        # sequence's fixed world frame -- this is what gives the tracker a
        # stable reference to measure real velocity against, without
        # distorting the density-adaptive clustering step itself.
        if ego is not None:
            for c in clusters:
                world_centroid = ego.to_world(np.array([c["centroid"]]), frame_id)[0]
                c["centroid"] = tuple(world_centroid.tolist())

        # ground truth per cluster: majority of its points labeled moving-X
        gt_dynamic_by_cluster_id = {}
        for c in clusters:
            cid = c["cluster_id"]
            mask = cluster_ids == cid
            gt_dynamic_by_cluster_id[cid] = bool(obs_moving[mask].mean() > 0.5)

        tracker.update(clusters)
        for track in tracker.tracks:
            if track.last_cluster_id is None:
                continue  # not matched to a detection this frame -- no ground truth to check
            decision = track.is_dynamic(velocity_threshold, min_frames)
            if decision is None:
                continue  # tracker hasn't seen enough frames yet to commit to a decision

            gt = gt_dynamic_by_cluster_id[track.last_cluster_id]
            if decision and gt:
                tp += 1
            elif decision and not gt:
                fp += 1
            elif not decision and not gt:
                tn += 1
            else:
                fn += 1
        n_evaluated_frames += 1

    total = tp + fp + tn + fn
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    recall = tp / (tp + fn) if (tp + fn) else float("nan")
    accuracy = (tp + tn) / total if total else float("nan")

    if verbose:
        mode = f"ego-motion compensated, dt={dt:.4f}s" if ego is not None else "RAW ego frame (no compensation)"
        print(f"Validated over {n_evaluated_frames} frames of {seq_dir} [{mode}]")
        print(f"  scored track-frame decisions: {total}  (tp={tp} fp={fp} tn={tn} fn={fn})")
        print(f"  precision (dynamic): {precision:.3f}")
        print(f"  recall (dynamic):    {recall:.3f}")
        print(f"  accuracy:            {accuracy:.3f}")

    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn, "precision": precision, "recall": recall, "accuracy": accuracy}


if __name__ == "__main__":
    seq_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SEQ_DIR
    n_frames = int(sys.argv[2]) if len(sys.argv) > 2 else None
    raw = "--no-compensation" in sys.argv

    if not os.path.isdir(seq_dir):
        print(f"No data at {seq_dir}.")
        print("Extract a frame range from data_odometry_velodyne.zip / data_odometry_labels.zip first:")
        print(f"  {seq_dir}/velodyne/000000.bin ...")
        print(f"  {seq_dir}/labels/000000.label ...")
        sys.exit(1)

    run_validation(seq_dir, n_frames, compensate_ego_motion=not raw)
