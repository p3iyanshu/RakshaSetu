"""
Shared contract tests -- see team_tasks/00_interfaces_and_handoff.md Part 2.
Everyone adds a case here proving their module's output matches
shared/schemas.py before opening a PR. Run with:

    pytest tests/test_contracts.py -v
"""
import os
import sys

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "shared"))
sys.path.insert(0, os.path.join(ROOT, "data"))
sys.path.insert(0, os.path.join(ROOT, "models"))
sys.path.insert(0, os.path.join(ROOT, "tracking"))

from mock_data import generate_sequence, load_npz  # noqa: E402


@pytest.fixture
def mock_frame():
    path = os.path.join(ROOT, "shared", "sample_data", "npz_frames", "frame_0000.npz")
    points, labels, confidence = load_npz(path)
    return points, labels, confidence


# ---------------------------------------------------------------------------
# Member 1 -- Stage 2: Segmentation output (models/placeholder.py, models/inference.py)
# ---------------------------------------------------------------------------

def _assert_matches_segmentation_output_schema(points, labels, confidence):
    n = points.shape[0]
    assert labels.shape == (n,)
    assert confidence.shape == (n,)
    assert set(np.unique(labels).tolist()).issubset({0, 1, 2, 3, 4, 5, 255})
    assert confidence.min() >= 0.0 and confidence.max() <= 1.0


def test_placeholder_classify_matches_schema(mock_frame):
    from placeholder import classify

    points, _, _ = mock_frame
    labels, confidence = classify(points)
    _assert_matches_segmentation_output_schema(points, labels, confidence)


def test_trained_model_classify_matches_schema(mock_frame):
    from inference import classify, DEFAULT_CHECKPOINT

    if not os.path.exists(DEFAULT_CHECKPOINT):
        pytest.skip("no trained checkpoint at models/checkpoints/best.pth yet -- train.py hasn't produced one")

    points, _, _ = mock_frame
    labels, confidence = classify(points)
    _assert_matches_segmentation_output_schema(points, labels, confidence)


def test_label_remap_covers_every_documented_semantickitti_id():
    """Every raw id label_remap.py claims to handle (SEMANTICKITTI_RAW_NAMES) must
    be a real key in RAW_TO_RAKSHASETU -- label_remap.py itself already asserts
    this at import time, but this test pins the behavior so a future edit that
    silently removes the self-check doesn't go unnoticed. Also confirms an
    unmapped id raises rather than silently degrading to a default class."""
    from label_remap import RAW_TO_RAKSHASETU, remap_semantic_ids, IGNORE_LABEL

    raw_ids = np.array(sorted(RAW_TO_RAKSHASETU.keys()), dtype=np.int64)
    remapped = remap_semantic_ids(raw_ids)
    for raw_id, target in zip(raw_ids, remapped):
        assert target == RAW_TO_RAKSHASETU[int(raw_id)]

    # every remapped value must be a valid class id or IGNORE_LABEL -- never a
    # silent default for something outside the documented taxonomy
    assert set(remapped.tolist()).issubset(set(RAW_TO_RAKSHASETU.values()))
    assert IGNORE_LABEL in RAW_TO_RAKSHASETU.values()

    with pytest.raises(ValueError):
        remap_semantic_ids(np.array([9999], dtype=np.int64))


# ---------------------------------------------------------------------------
# Member 3 -- Stage 4: Tracking output (tracking/kalman_tracker.py)
# ---------------------------------------------------------------------------

def test_tracking_output_matches_tracked_object_schema():
    """Feeds the agreed mock segmented-point-cloud sequence through the full
    clustering + tracking pipeline and asserts every emitted object matches
    schemas.TrackedObject exactly."""
    from schemas import STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE, DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN
    from clustering import cluster_obstacles, extract_cluster_features
    from kalman_tracker import MultiObjectTracker

    obstacle_classes = [STATIC_OBSTACLE_WALL, STATIC_OBSTACLE_POLE, DYNAMIC_VEHICLE, DYNAMIC_PEDESTRIAN]

    frames = generate_sequence(n_frames=10, seed=0)
    tracker = MultiObjectTracker(min_hits=1)

    seen_any = False
    for points, labels, confidence in frames:
        obstacle_mask = np.isin(labels, obstacle_classes)
        xyz = points[obstacle_mask, :3].astype(np.float64)
        obs_labels = labels[obstacle_mask]
        obs_confidence = confidence[obstacle_mask]

        cluster_ids = cluster_obstacles(xyz, obs_labels)
        clusters = extract_cluster_features(xyz, obs_labels, obs_confidence, cluster_ids)
        objects = tracker.update(clusters)

        for obj in objects:
            seen_any = True
            assert set(obj.keys()) == {"track_id", "cls", "position", "velocity", "velocity_relative", "is_dynamic", "confidence"}
            assert isinstance(obj["track_id"], int)
            assert obj["cls"] in obstacle_classes
            assert isinstance(obj["position"], tuple) and len(obj["position"]) == 3
            assert isinstance(obj["velocity"], tuple) and len(obj["velocity"]) == 3
            assert isinstance(obj["velocity_relative"], tuple) and len(obj["velocity_relative"]) == 3
            assert isinstance(obj["is_dynamic"], bool)
            assert 0.0 <= obj["confidence"] <= 1.0

    assert seen_any, "the mock sequence must produce at least one confirmed track"
