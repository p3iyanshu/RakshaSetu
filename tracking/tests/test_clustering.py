import numpy as np
import pytest

from clustering import cluster_obstacles, extract_cluster_features, OBSTACLE_CLASSES
from schemas import STATIC_OBSTACLE_WALL, DYNAMIC_VEHICLE
from mock_data import generate_frame


def test_cluster_obstacles_separates_distinct_objects():
    rng = np.random.default_rng(0)
    blob_a = rng.normal((5.0, 0.0, 1.0), 0.05, size=(30, 3))
    blob_b = rng.normal((5.0, 20.0, 1.0), 0.05, size=(30, 3))  # far away, same radial ring
    points = np.concatenate([blob_a, blob_b])
    labels = np.full(60, STATIC_OBSTACLE_WALL)

    cluster_ids = cluster_obstacles(points, labels)

    assert (cluster_ids != -1).all(), "dense, tight blobs should not be marked as noise"
    ids_a = set(cluster_ids[:30].tolist())
    ids_b = set(cluster_ids[30:].tolist())
    assert len(ids_a) == 1 and len(ids_b) == 1
    assert ids_a != ids_b, "two spatially separated blobs must get different cluster ids"


def test_cluster_obstacles_marks_sparse_points_as_noise():
    rng = np.random.default_rng(1)
    scattered = rng.uniform(-50, 50, size=(10, 3))  # spread too thin to form a cluster
    labels = np.full(10, STATIC_OBSTACLE_WALL)

    cluster_ids = cluster_obstacles(scattered, labels)

    assert (cluster_ids == -1).all()


def test_cluster_ids_unique_across_radial_rings():
    # two tight blobs in different radial rings (near vs far) must not collide on cluster id
    rng = np.random.default_rng(2)
    near = rng.normal((5.0, 0.0, 1.0), 0.02, size=(20, 3))
    far = rng.normal((45.0, 0.0, 1.0), 0.05, size=(20, 3))
    points = np.concatenate([near, far])
    labels = np.full(40, STATIC_OBSTACLE_WALL)

    cluster_ids = cluster_obstacles(points, labels)

    ids_near = set(cluster_ids[:20].tolist()) - {-1}
    ids_far = set(cluster_ids[20:].tolist()) - {-1}
    assert ids_near and ids_far
    assert ids_near.isdisjoint(ids_far)


def test_extract_cluster_features_matches_known_cluster():
    rng = np.random.default_rng(3)
    pts = rng.normal((10.0, 2.0, 1.0), 0.01, size=(50, 3))
    labels = np.full(50, DYNAMIC_VEHICLE)
    confidence = np.full(50, 0.8)
    cluster_ids = np.zeros(50, dtype=np.int64)

    clusters = extract_cluster_features(pts, labels, confidence, cluster_ids)

    assert len(clusters) == 1
    c = clusters[0]
    assert set(c.keys()) == {"cluster_id", "centroid", "bbox_min", "bbox_max",
                              "point_count", "dominant_class", "mean_confidence"}
    assert c["point_count"] == 50
    assert c["dominant_class"] == DYNAMIC_VEHICLE
    assert np.allclose(c["centroid"], (10.0, 2.0, 1.0), atol=0.05)
    assert c["mean_confidence"] == pytest.approx(0.8)


def test_extract_cluster_features_excludes_noise():
    pts = np.zeros((5, 3))
    labels = np.full(5, STATIC_OBSTACLE_WALL)
    confidence = np.full(5, 0.9)
    cluster_ids = np.full(5, -1)  # everything is noise

    clusters = extract_cluster_features(pts, labels, confidence, cluster_ids)

    assert clusters == []


def test_cluster_obstacles_on_mock_frame_finds_plausible_object_count():
    # sanity check against the shared mock scene: 3 walls + 5 poles +
    # 2 pedestrians + 1 vehicle = 11 real objects; DBSCAN may split/merge a
    # couple, so assert a loose range rather than exact equality.
    rng = np.random.default_rng(0)
    points, labels, confidence = generate_frame(rng, t=0.0)
    obstacle_mask = np.isin(labels, OBSTACLE_CLASSES)
    xyz = points[obstacle_mask, :3].astype(np.float64)
    obs_labels = labels[obstacle_mask]
    obs_confidence = confidence[obstacle_mask]

    cluster_ids = cluster_obstacles(xyz, obs_labels)
    clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)

    # walls are long/sparse enough to legitimately split into a few DBSCAN
    # sub-clusters at this eps, so allow real headroom above the 11 real
    # objects -- this is a sanity check (pipeline runs, finds *something*
    # plausible), not a precise ground-truth count.
    assert 8 <= len(clusters) <= 22
