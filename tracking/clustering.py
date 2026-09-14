"""
Task 1 & 2 from team_tasks/03_clustering_and_tracking.md

Groups obstacle points (static_obstacle / dynamic_object) into candidate
objects, using DBSCAN with eps tuned per radial distance band so that the
naturally sparser far-range points don't get over- or under-clustered by a
single fixed eps. Bands match Member 2's adaptive-grid resolution rings.
"""
import os
import sys

import numpy as np
from sklearn.cluster import DBSCAN
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared"))
from schemas import (
    STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE,
    DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN, RING_BOUNDARIES,
)

# v2 (2026-09-12): the old scheme's single STATIC/DYNAMIC pair no longer
# covers Segmentation's output -- static split into wall/pole, dynamic split
# into vehicle/pedestrian (shared/schemas.py). Imported from there instead
# of hand-duplicated here, same for RING_BOUNDARIES, so this module can't
# silently drift out of sync with Member 1's classes or Member 2's grid
# resolution bands again.
OBSTACLE_CLASSES = (STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE, DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN)
STATIC_CLASSES = (STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE)
DYNAMIC_CLASSES = (DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN)

EPS_TO_CELL_RATIO = 6.0  # eps = cell_size * this ratio, tune during real testing
MIN_SAMPLES = 5


def _ring_eps(radius_m):
    for lo, hi, cell_size in RING_BOUNDARIES:
        if lo <= radius_m < hi:
            return cell_size * EPS_TO_CELL_RATIO
    return RING_BOUNDARIES[-1][2] * EPS_TO_CELL_RATIO  # beyond 100m: use farthest band


def _stitch_ring_boundaries(points_xyz, radius, cluster_ids, ring_eps):
    """Union cluster ids split across a ring boundary.

    Per-ring DBSCAN never compares a point in ring i against a point in ring
    i+1, even when they're spatially adjacent -- two points from the same
    physical object that happen to straddle a ring boundary come back as two
    separate cluster ids, not because they're far apart, but because they
    were never in the same DBSCAN call. Finer near-field bands (Member 2's
    finalized 8-band RING_BOUNDARIES) make this much more likely to bite: a
    real near-field object of nontrivial size now has 5 nearby boundaries
    instead of 1 to straddle.

    Fix: a point's radius is 1-Lipschitz in Euclidean distance (|r_a - r_b|
    <= |p_a - p_b|), so two points within `eps` of each other must also be
    within `eps` of each other's radius -- meaning only points within `eps`
    of the shared boundary on either side can possibly need merging. For
    each adjacent ring pair, check just those near-boundary points (already
    clustered, non-noise) against each other and union any cluster ids
    whose points land within min(eps_a, eps_b) across the boundary.
    """
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(len(ring_eps) - 1):
        lo_a, hi_a, eps_a = ring_eps[i]
        lo_b, hi_b, eps_b = ring_eps[i + 1]
        if hi_a != lo_b:
            continue  # RING_BOUNDARIES isn't contiguous here -- nothing to stitch
        merge_eps = min(eps_a, eps_b)
        boundary = hi_a

        side_a_mask = (radius >= boundary - merge_eps) & (radius < boundary) & (cluster_ids != -1)
        side_b_mask = (radius >= boundary) & (radius < boundary + merge_eps) & (cluster_ids != -1)
        if not np.any(side_a_mask) or not np.any(side_b_mask):
            continue

        ids_a = cluster_ids[side_a_mask]
        ids_b = cluster_ids[side_b_mask]
        tree_b = cKDTree(points_xyz[side_b_mask])
        for a_idx, neighbors in enumerate(tree_b.query_ball_point(points_xyz[side_a_mask], r=merge_eps)):
            for b_idx in neighbors:
                union(int(ids_a[a_idx]), int(ids_b[b_idx]))

    # Relabel every cluster id (touched by a union or not) to its root, then
    # to a dense 0..k-1 range -- keeps the "small contiguous ids" contract
    # extract_cluster_features and everything downstream already relies on.
    present_ids = [cid for cid in np.unique(cluster_ids).tolist() if cid != -1]
    roots = {cid: find(cid) for cid in present_ids}
    root_to_new_id = {r: new_id for new_id, r in enumerate(sorted(set(roots.values())))}

    remapped = cluster_ids.copy()
    for cid in present_ids:
        remapped[cluster_ids == cid] = root_to_new_id[roots[cid]]
    return remapped


def cluster_obstacles(points_xyz, labels, min_samples=MIN_SAMPLES):
    """Runs DBSCAN per radial ring, with eps scaled to that ring's grid resolution,
    then stitches clusters back together across ring boundaries (see
    _stitch_ring_boundaries) so an object straddling a boundary isn't split.

    points_xyz: (N, 3) array, ego-vehicle-relative x, y, z
    labels: (N,) array with values in {STATIC, DYNAMIC} (drivable/ignore already filtered out)

    Returns cluster_ids: (N,) int array, -1 = noise, otherwise a cluster id
    unique across the whole frame (not just within one ring).
    """
    n = points_xyz.shape[0]
    cluster_ids = np.full(n, -1, dtype=np.int64)
    radius = np.linalg.norm(points_xyz[:, :2], axis=1)  # planar distance from ego vehicle

    next_id = 0
    ring_eps = []
    for lo, hi, cell_size in RING_BOUNDARIES:
        eps = cell_size * EPS_TO_CELL_RATIO
        ring_eps.append((lo, hi, eps))
        ring_mask = (radius >= lo) & (radius < hi)
        if not np.any(ring_mask):
            continue
        ring_points = points_xyz[ring_mask]
        db = DBSCAN(eps=eps, min_samples=min_samples).fit(ring_points)
        ring_labels = db.labels_

        local_ids = np.full_like(ring_labels, -1)
        for local_cluster in np.unique(ring_labels):
            if local_cluster == -1:
                continue
            local_ids[ring_labels == local_cluster] = next_id
            next_id += 1

        cluster_ids[ring_mask] = local_ids

    if next_id > 0:
        cluster_ids = _stitch_ring_boundaries(points_xyz, radius, cluster_ids, ring_eps)

    return cluster_ids


def extract_cluster_features(points_xyz, labels, confidence, cluster_ids):
    """Task 2: per-cluster centroid, bbox, point count, dominant class, mean confidence.

    Returns a list of dicts, one per cluster (noise points excluded).
    """
    clusters = []
    for cid in sorted(set(cluster_ids.tolist()) - {-1}):
        mask = cluster_ids == cid
        pts = points_xyz[mask]
        cls_labels = labels[mask]
        conf = confidence[mask]

        classes, counts = np.unique(cls_labels, return_counts=True)
        dominant_class = int(classes[np.argmax(counts)])

        clusters.append({
            "cluster_id": int(cid),
            "centroid": tuple(pts.mean(axis=0).round(3).tolist()),
            "bbox_min": tuple(pts.min(axis=0).round(3).tolist()),
            "bbox_max": tuple(pts.max(axis=0).round(3).tolist()),
            "point_count": int(mask.sum()),
            "dominant_class": dominant_class,  # one of OBSTACLE_CLASSES (wall/pole/vehicle/pedestrian)
            "mean_confidence": float(conf.mean().round(3)),
        })
    return clusters


if __name__ == "__main__":
    from mock_data import load_npz

    points, labels, confidence = load_npz("../shared/sample_data/npz_frames/frame_0000.npz")
    obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)
    xyz = points[obstacle_mask, :3]
    obs_labels = labels[obstacle_mask]
    obs_confidence = confidence[obstacle_mask]

    cluster_ids = cluster_obstacles(xyz, obs_labels)
    clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)

    print(f"Found {len(clusters)} clusters from {xyz.shape[0]} obstacle points "
          f"({(cluster_ids == -1).sum()} noise points)\n")
    for c in clusters:
        cls_name = "static" if c["dominant_class"] in STATIC_CLASSES else "dynamic"
        print(f"  cluster {c['cluster_id']}: {cls_name}, "
              f"{c['point_count']} pts, centroid={c['centroid']}, "
              f"conf={c['mean_confidence']}")
