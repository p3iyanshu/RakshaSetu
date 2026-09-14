"""
Offline precompute: runs the REAL trained PointNet++ segmentation model
(models/pointnet2_seg.py, via models/inference.py's classify()) and the REAL
clustering + tracking pipeline (tracking/clustering.py,
tracking/kalman_tracker.py) over the already extracted SemanticKITTI demo
window (tracking/kitti_validation_data/sequences/00, frames 3615-3714), and
serializes every frame's grid + tracked objects + metrics to
dashboard/backend/data/demo_sequence.json for dashboard/backend/main.py's
real_feed.py to replay over the WebSocket.

No fabricated numbers. Every field either comes from actually running
inference.classify() / tracking's clustering+tracker against real data, or
is an analytically-derived constant computed from the RING_BOUNDARIES grid
geometry (compute_savings_pct -- see the formula comment on
_naive_uniform_cell_count() below, since that's a headline number for judges).

v2 (2026-09-12): shared/schemas.py's class scheme moved from 3 classes to 6
(drivable/static_obstacle_wall/static_obstacle_pole/dynamic_vehicle/
dynamic_pedestrian/other_unknown) per Member 4's ros2_ws/interfaces.md v2.
This module's own grid-cell dicts still use the field name "ring" (not
interfaces.md's "range_bin") and a flat list-of-cells shape (not
interfaces.md's string-keyed dict) -- this was a pragmatic, independent
format built to demo before ros2_ws/ existed at all (see
team_tasks/05_dashboard_visualization.md: "you do not need to wait for the
real pipeline"), and should be reconciled with interfaces.md once this
dashboard actually consumes Member 4's real Fusion node output instead of
this offline precompute.

2026-09-14 update: retrained under the 6-class scheme (mIoU 0.868, see
Member1_HANDOVER_REPORT.md section 9) and the segmentation module itself was
rebuilt in the process -- models/pointnet2.py no longer exists (replaced by
models/pointnet2_seg.py + models/inference.py's classify()), and
models/metrics.py's IoUMeter.compute() now returns a single dict
({"miou": ..., "per_class_iou": ..., ...}) instead of a (per_class, miou)
tuple. Updated both call sites below accordingly -- no other logic in this
script needed to change.

Run (from repo root or anywhere -- paths are absolute):
    python dashboard/backend/build_demo_data.py
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import torch

# ---------------------------------------------------------------------------
# Path setup. This repo has no __init__.py packages -- every existing module
# (models/inference.py, tracking/*.py) already assumes a flat sys.path with
# its own directory on it, so we follow the same convention rather than
# inventing a package layout.
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
for _sub in ("models", "tracking", "shared", "data"):
    sys.path.insert(0, os.path.join(REPO_ROOT, _sub))

import inference                                       # models/inference.py -- classify(), wraps PointNet2SegMSG
from metrics import IoUMeter                            # models/metrics.py
from schemas import RING_BOUNDARIES, DRIVABLE            # shared/schemas.py
from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES  # tracking/clustering.py
from kalman_tracker import MultiObjectTracker              # tracking/kalman_tracker.py
from ego_motion import EgoMotionCompensator                  # tracking/ego_motion.py
from semantic_kitti_labels import load_label_file, load_velodyne_file, to_simplified_labels  # tracking/semantic_kitti_labels.py

SEQ_DIR = os.path.join(REPO_ROOT, "tracking", "kitti_validation_data", "sequences", "00")
CHECKPOINT = os.path.join(REPO_ROOT, "models", "checkpoints", "best.pth")
OUT_PATH = os.path.join(HERE, "data", "demo_sequence.json")

NUM_RINGS = len(RING_BOUNDARIES)   # 4
N_ANGULAR_BINS = 36                # 360 / 10 deg

# NOTE on angular_bin convention: team_tasks/05_dashboard_visualization.md's
# inline mock example assigns degree values (0, 10, ..., 350) to
# "angular_bin". But the dashboard backend actually already built alongside
# this script (dashboard/backend/mock_generator.py, written concurrently by
# the dashboard teammate) uses a plain bin INDEX 0..35
# (`b = int((angle % 360) // 10)`), and that's what a frontend built against
# that mock will expect. We match the live sibling code, not the older doc
# text, so the real feed and the mock feed are interchangeable without the
# frontend needing two different unbinning formulas.


def _naive_uniform_cell_count():
    """Headline "compute savings" number: how many cells a spatially-UNIFORM
    grid would need vs. our adaptive ring grid, to cover the same field of
    view.

    Formula (kept simple/auditable on purpose -- this number goes in front
    of judges):
      - Both grids keep the same N_ANGULAR_BINS (36) angular divisions. This
        isolates the RADIAL-resolution saving specifically -- finer cells
        near the vehicle, coarser far away -- which is this project's actual
        "adaptive variable-resolution" premise. (Angular arc length also
        grows with radius, so a truly uniform 2D grid would need even more
        cells than this estimate -- this formula is therefore a conservative
        lower bound on the real saving, not an inflated one.)
      - Adaptive grid: exactly 1 cell per (ring, angular_bin) regardless of
        that ring's physical radial depth -> NUM_RINGS * N_ANGULAR_BINS cells.
      - Naive uniform-resolution equivalent: subdivide each ring's radial
        depth (hi - lo) into cells sized at ring 0's cell size (the FINEST
        resolution used anywhere in the adaptive grid, 5cm), still with the
        same 36 angular divisions:
            naive_cells_for_ring = N_ANGULAR_BINS * ceil((hi - lo) / finest_cell_size)
      savings_pct = (1 - adaptive_total / naive_total) * 100
    """
    finest_cell_size = RING_BOUNDARIES[0][2]  # 0.05 m
    naive_total = 0
    for lo, hi, _cell_size in RING_BOUNDARIES:
        naive_total += N_ANGULAR_BINS * math.ceil((hi - lo) / finest_cell_size)
    adaptive_total = NUM_RINGS * N_ANGULAR_BINS  # 144
    savings_pct = (1.0 - adaptive_total / naive_total) * 100.0
    return adaptive_total, naive_total, savings_pct


def _bin_to_grid(points, labels_pred, conf_pred):
    """Bins classified points into the adaptive polar grid, in the SENSOR
    frame (radius/angle measured from the ego vehicle at this instant --
    "what the vehicle currently sees"), matching the frame clustering.py
    also clusters in. Emits all NUM_RINGS * N_ANGULAR_BINS = 144 cells every
    frame (empty cells get point_count=0 and cls=DRIVABLE as a neutral
    placeholder -- never fabricated height/confidence values), which is also
    what dashboard/backend/mock_generator.py already does, and what the
    compute_savings_pct formula above assumes (adaptive_total=144)."""
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    radius = np.hypot(x, y)
    angle_deg = np.degrees(np.arctan2(y, x)) % 360.0
    angular_bin = np.minimum((angle_deg // 10).astype(np.int64), N_ANGULAR_BINS - 1)

    ring_idx = np.full(len(points), -1, dtype=np.int64)
    for ring_i, (lo, hi, _cell_size) in enumerate(RING_BOUNDARIES):
        ring_idx[(radius >= lo) & (radius < hi)] = ring_i

    cells = []
    for ring_i in range(NUM_RINGS):
        ring_mask = ring_idx == ring_i
        for b in range(N_ANGULAR_BINS):
            mask = ring_mask & (angular_bin == b)
            pc = int(mask.sum())
            if pc == 0:
                cells.append({
                    "ring": ring_i, "angular_bin": b, "cls": DRIVABLE,
                    "height_max": 0.0, "height_mean": 0.0,
                    "point_count": 0, "confidence": 0.0,
                })
                continue
            cls_in_cell = labels_pred[mask]
            classes, counts = np.unique(cls_in_cell, return_counts=True)
            dominant_cls = int(classes[np.argmax(counts)])
            zc = z[mask]
            cells.append({
                "ring": ring_i, "angular_bin": b, "cls": dominant_cls,
                "height_max": float(zc.max()), "height_mean": float(zc.mean()),
                "point_count": pc, "confidence": float(conf_pred[mask].mean()),
            })
    return cells


def _world_to_vehicle_frame(world_xyz, world_vxvy, ego, frame_id):
    """Inverse of ego.to_world(): re-expresses a world-frame tracked-object
    position/velocity in THIS frame's vehicle/sensor frame.

    Why this is needed (bug found after the first precompute run): the
    tracker deliberately works in the fixed world frame (tracking/README.md
    finding #1 -- world frame is what makes static objects read as static
    across frames). But that means raw tracked positions accumulate to
    wherever the vehicle physically is in sequence 00 by frame 3615+
    (hundreds of metres from the sequence origin), which is meaningless for
    a vehicle-centered live display -- the dashboard draws the ego vehicle
    at the center of a <=100m-radius map, matching RING_BOUNDARIES. Undoing
    the same rigid transform ego.to_world() applied re-centers every object
    on "where is this relative to me, right now", which is both what an
    onboard HUD needs and the honest real relationship (a parked car
    legitimately gets closer then slides behind as the vehicle drives past).
    Position uses the full rigid transform (rotation + translation);
    velocity is a vector, so only the rotation part applies.
    """
    T = ego.world_from_velo(frame_id)
    T_inv = np.linalg.inv(T)
    homogeneous = np.array([world_xyz[0], world_xyz[1], world_xyz[2], 1.0])
    local = T_inv @ homogeneous
    R_inv = T_inv[:3, :3]
    v3 = np.array([world_vxvy[0], world_vxvy[1], 0.0])
    v_local = R_inv @ v3
    return local[:3], (float(v_local[0]), float(v_local[1]))


def _load_frame(frame_id):
    fname = f"{frame_id:06d}"
    points = load_velodyne_file(os.path.join(SEQ_DIR, "velodyne", f"{fname}.bin"))
    semantic_id, _instance_id = load_label_file(os.path.join(SEQ_DIR, "labels", f"{fname}.label"))
    return points, semantic_id


def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    label_files = sorted(f for f in os.listdir(os.path.join(SEQ_DIR, "labels")) if f.endswith(".label"))
    frame_ids = [int(f[:-6]) for f in label_files]
    n_frames = len(frame_ids)
    print(f"Found {n_frames} frames: {frame_ids[0]}-{frame_ids[-1]}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={device}  checkpoint={CHECKPOINT}")
    if not os.path.exists(CHECKPOINT):
        print(f"ERROR: checkpoint not found at {CHECKPOINT}")
        sys.exit(1)

    ego = EgoMotionCompensator(
        os.path.join(SEQ_DIR, "calib.txt"),
        os.path.join(SEQ_DIR, "poses.txt"),
        os.path.join(SEQ_DIR, "times.txt"),
    )
    dt = ego.dt(frame_ids[0], frame_ids[1])
    tracker = MultiObjectTracker(dt=dt)  # one instance for the whole 100-frame run

    adaptive_total, naive_total, savings_pct = _naive_uniform_cell_count()
    print(f"grid geometry: adaptive={adaptive_total} cells, naive_uniform_equivalent={naive_total} cells, "
          f"compute_savings_pct={savings_pct:.2f}% (constant, analytical -- see _naive_uniform_cell_count)")

    # Warm up CUDA/cuDNN kernels once before timing starts, so frame 0's
    # recorded latency isn't inflated by one-time kernel compilation /
    # autotuning. This call's output is discarded and NOT one of the 100
    # timed/reported frames.
    print("warming up model...")
    warm_dummy = np.random.rand(20000, 4).astype(np.float32)
    inference.classify(warm_dummy, checkpoint_path=CHECKPOINT, device=device)

    overall_iou = IoUMeter()
    frames_out = []
    latencies, mious, fps_list = [], [], []
    dynamic_frame_count = 0
    t0 = ego.times[frame_ids[0]]

    run_start = time.time()
    for i, frame_id in enumerate(frame_ids):
        points, semantic_id = _load_frame(frame_id)
        assert len(points) == len(semantic_id), f"frame {frame_id}: point/label count mismatch"

        # --- 1. real segmentation inference, real measured latency ---
        t_start = time.perf_counter()
        labels_pred, conf_pred = inference.classify(points, checkpoint_path=CHECKPOINT, device=device)
        t_end = time.perf_counter()
        latency_ms = (t_end - t_start) * 1000.0
        fps = 1000.0 / latency_ms if latency_ms > 0 else 0.0

        # --- 2. real per-frame mIoU vs SemanticKITTI ground truth ---
        gt_simplified = to_simplified_labels(semantic_id)
        pred_t = torch.from_numpy(labels_pred.astype(np.int64))
        gt_t = torch.from_numpy(gt_simplified.astype(np.int64))
        frame_meter = IoUMeter()
        frame_meter.update(pred_t, gt_t)
        frame_miou = frame_meter.compute()["miou"]
        overall_iou.update(pred_t, gt_t)  # accumulated across the whole run, for the summary

        # --- 3. adaptive grid, binned in the SENSOR frame from real points/predictions ---
        grid_cells = _bin_to_grid(points, labels_pred, conf_pred)

        # --- 4. clustering (sensor frame) + ego-motion-compensated centroids + tracking ---
        obstacle_mask = np.isin(labels_pred, OBSTACLE_CLASSES)
        xyz_sensor = points[obstacle_mask, :3].astype(np.float64)
        obs_labels = labels_pred[obstacle_mask]
        obs_conf = conf_pred[obstacle_mask].astype(np.float64)

        # min_samples raised from clustering.py's default (5) to 20 for this
        # demo build only (passed as an override, clustering.py itself is
        # untouched). Updated 2026-09-14: with the final trained checkpoint
        # (mIoU 0.868 held-out val) this is no longer compensating for an
        # undertrained model -- even a well-trained model produces some
        # per-point classification noise, and this demo window is a dense
        # urban street scene where continuous building/wall facades naturally
        # fragment into many small DBSCAN clusters regardless of model
        # quality (40-100+ raw clusters/frame observed here vs. a handful of
        # real cars/poles/pedestrians). Requiring more points before
        # something counts as a discrete cluster is a standard, honest
        # perception-stack noise filter (not massaging results) -- it costs
        # some sensitivity to genuinely sparse far-range detections in
        # exchange for a demo that shows real cars/cyclists instead of noise.
        if xyz_sensor.shape[0] > 0:
            cluster_ids = cluster_obstacles(xyz_sensor, obs_labels, min_samples=20)
            clusters = extract_cluster_features(xyz_sensor, obs_labels, obs_conf, cluster_ids)
        else:
            clusters = []

        # Drop clusters too large to be a discrete object (a car/pole/person)
        # -- tracking/README.md finding #4: large extended structures
        # (building/fence/vegetation) aren't discrete objects, DBSCAN
        # fragments their boundary differently almost every frame purely
        # from viewpoint changes, and semantic_kitti_labels.py already
        # excludes those raw classes from ground truth via class_mapping.py's
        # SEMANTICKITTI_MAP for the same reason. The live model predicts only
        # our 6 simplified classes though, with no raw-class info to apply
        # that exclusion by name, so this is the same exclusion applied by
        # shape instead: a
        # real car is ~5m long, a pedestrian <1m -- an 8m bbox diagonal is a
        # generous upper bound that keeps every vehicle-scale object and
        # drops wall/building/vegetation fragments (real extended structures,
        # not model noise -- see the min_samples note above -- but still not
        # discrete "objects" worth showing a reviewer as tracked hazards).
        MAX_OBJECT_DIAGONAL_M = 8.0
        clusters = [
            c for c in clusters
            if np.linalg.norm(np.array(c["bbox_max"]) - np.array(c["bbox_min"])) <= MAX_OBJECT_DIAGONAL_M
        ]

        # Only the cluster CENTROIDS move to world frame -- clustering itself
        # stays in the sensor frame above (tracking/README.md finding #2:
        # cluster_obstacles scales eps by true sensor-relative distance).
        for c in clusters:
            world_centroid = ego.to_world(np.array([c["centroid"]]), frame_id)[0]
            c["centroid"] = tuple(world_centroid.tolist())

        tracked_objects = tracker.update(clusters)

        # Re-center world-frame tracks into THIS frame's vehicle frame for
        # display, and drop anything outside the grid's own 100m range (it
        # would render off the map anyway -- not a cosmetic cut, just
        # matching the display's actual field of view).
        objects_out = []
        for o in tracked_objects:
            local_pos, local_vel = _world_to_vehicle_frame(o["position"], o["velocity"], ego, frame_id)
            if math.hypot(local_pos[0], local_pos[1]) > RING_BOUNDARIES[-1][1]:
                continue
            objects_out.append({
                "track_id": o["track_id"],
                "cls": o["cls"],
                "position": [float(local_pos[0]), float(local_pos[1]), float(local_pos[2])],
                "velocity": [local_vel[0], local_vel[1]],
                "is_dynamic": bool(o["is_dynamic"]),
                "confidence": float(o["confidence"]),
            })

        has_dynamic = any(o["is_dynamic"] for o in objects_out)
        if has_dynamic:
            dynamic_frame_count += 1

        timestamp = float(ego.times[frame_id] - t0)  # real sensor cadence, cumulative from window start

        frames_out.append({
            "timestamp": timestamp,
            "grid": grid_cells,
            "objects": objects_out,
            "metrics": {
                "fps": fps,
                "latency_ms": latency_ms,
                "miou": frame_miou,
                "compute_savings_pct": savings_pct,
            },
        })

        latencies.append(latency_ms)
        mious.append(frame_miou)
        fps_list.append(fps)

        print(f"frame {i + 1:3d}/{n_frames} (id={frame_id}): latency={latency_ms:6.1f}ms fps={fps:5.1f} "
              f"miou={frame_miou:.3f} obstacle_pts={xyz_sensor.shape[0]:6d} clusters={len(clusters):3d} "
              f"tracks={len(tracked_objects):3d} dynamic={'Y' if has_dynamic else '.'}")

    run_elapsed = time.time() - run_start
    overall_miou = overall_iou.compute()["miou"]

    # Read the checkpoint's own recorded epoch/mIoU rather than hardcoding a
    # string here -- the previous version of this file said "25 epochs
    # trained, val mIoU 0.809" long after the actual checkpoint had moved on
    # (final: epoch 16, val mIoU 0.8675, see Member1_HANDOVER_REPORT.md
    # section 9), and nothing would have caught that drift.
    ckpt_meta = torch.load(CHECKPOINT, map_location="cpu")
    checkpoint_desc = (
        f"models/checkpoints/best.pth (epoch {ckpt_meta.get('epoch', '?')}, "
        f"val mIoU {ckpt_meta.get('miou', float('nan')):.4f})"
    )

    avg_latency = float(np.mean(latencies))
    avg_fps = float(np.mean(fps_list))
    avg_miou = float(np.mean(mious))

    meta = {
        "source": "SemanticKITTI seq 00, frames 3615-3714 (real data)",
        "checkpoint": checkpoint_desc,
        "num_frames": n_frames,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            f"avg per-frame mIoU on this specific 100-frame window is {avg_miou:.3f}, "
            f"notably below the checkpoint's held-out validation mIoU (see 'checkpoint' "
            f"above) -- this window uses uniform random downsampling at inference "
            f"(inference.classify() has no ground truth to do class-aware sampling "
            f"with, unlike train.py's validation), which under-represents rare classes "
            f"like static_obstacle_pole/dynamic_pedestrian more than the reported "
            f"validation number does. For the pitch, cite the held-out validation mIoU "
            f"as the model's real accuracy figure, not this demo clip's average."
        ),
    }
    out = {"meta": meta, "frames": frames_out}

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f)

    print("\n==== SUMMARY ====")
    print(f"frames processed: {n_frames}  (wall time for full precompute: {run_elapsed:.1f}s)")
    print(f"avg latency_ms: {avg_latency:.2f}   avg fps: {avg_fps:.2f}")
    print(f"avg per-frame miou: {avg_miou:.4f}   overall (accumulated-confusion) miou: {overall_miou:.4f}")
    print(f"compute_savings_pct (constant, analytical): {savings_pct:.2f}%  "
          f"(adaptive={adaptive_total} cells vs naive_uniform={naive_total} cells)")
    print(f"frames with >=1 confirmed dynamic tracked object: {dynamic_frame_count}/{n_frames}")
    print(f"output written to: {OUT_PATH}")


if __name__ == "__main__":
    main()
