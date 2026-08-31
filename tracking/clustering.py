"""
Task 1 & 2 from team_tasks/03_clustering_and_tracking.md

Groups obstacle points (static_obstacle / dynamic_object) into candidate
objects, using DBSCAN with eps tuned per radial distance band so that the
naturally sparser far-range points don't get over- or under-clustered by a
single fixed eps. Bands match Member 2's adaptive-grid resolution rings.
"""
import numpy as np
from sklearn.cluster import DBSCAN

STATIC = 1
DYNAMIC = 2

# (min_radius_m, max_radius_m, grid_cell_size_m) -- same bands as the grid engine
RING_BOUNDARIES = [
    (0.0, 10.0, 0.05),
    (10.0, 30.0, 0.15),
    (30.0, 60.0, 0.30),
    (60.0, 100.0, 0.50),
]
EPS_TO_CELL_RATIO = 6.0  # eps = cell_size * this ratio, tune during real testing
MIN_SAMPLES = 5


def _ring_eps(radius_m):
    for lo, hi, cell_size in RING_BOUNDARIES:
        if lo <= radius_m < hi:
            return cell_size * EPS_TO_CELL_RATIO
    return RING_BOUNDARIES[-1][2] * EPS_TO_CELL_RATIO  # beyond 100m: use farthest band


def cluster_obstacles(points_xyz, labels, min_samples=MIN_SAMPLES):
    """Runs DBSCAN per radial ring, with eps scaled to that ring's grid resolution.

    points_xyz: (N, 3) array, ego-vehicle-relative x, y, z
    labels: (N,) array with values in {STATIC, DYNAMIC} (drivable/ignore already filtered out)

    Returns cluster_ids: (N,) int array, -1 = noise, otherwise a cluster id
    unique across the whole frame (not just within one ring).
    """
    n = points_xyz.shape[0]
    cluster_ids = np.full(n, -1, dtype=np.int64)
    radius = np.linalg.norm(points_xyz[:, :2], axis=1)  # planar distance from ego vehicle

    next_id = 0
    for lo, hi, cell_size in RING_BOUNDARIES:
        ring_mask = (radius >= lo) & (radius < hi)
        if not np.any(ring_mask):
            continue
        eps = cell_size * EPS_TO_CELL_RATIO
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
            "dominant_class": dominant_class,  # 1=static_obstacle, 2=dynamic_object
            "mean_confidence": float(conf.mean().round(3)),
        })
    return clusters


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "../shared")
    from mock_data import load_npz

    points, labels, confidence = load_npz("../shared/sample_data/npz_frames/frame_0000.npz")
    obstacle_mask = np.isin(labels, [STATIC, DYNAMIC])
    xyz = points[obstacle_mask, :3]
    obs_labels = labels[obstacle_mask]
    obs_confidence = confidence[obstacle_mask]

    cluster_ids = cluster_obstacles(xyz, obs_labels)
    clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)

    print(f"Found {len(clusters)} clusters from {xyz.shape[0]} obstacle points "
          f"({(cluster_ids == -1).sum()} noise points)\n")
    for c in clusters:
        cls_name = "static" if c["dominant_class"] == STATIC else "dynamic"
        print(f"  cluster {c['cluster_id']}: {cls_name}, "
              f"{c['point_count']} pts, centroid={c['centroid']}, "
              f"conf={c['mean_confidence']}")
