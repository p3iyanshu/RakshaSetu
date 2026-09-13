import numpy as np
import pytest

from kalman_tracker import MultiObjectTracker
from schemas import STATIC_OBSTACLE_WALL, DYNAMIC_VEHICLE


def _det(cluster_id, xyz, cls=STATIC_OBSTACLE_WALL, conf=0.9):
    return {"cluster_id": cluster_id, "centroid": tuple(xyz), "dominant_class": cls, "mean_confidence": conf}


def test_stationary_object_is_classified_static_after_min_frames():
    tracker = MultiObjectTracker(velocity_threshold=0.3, min_frames_for_decision=5, min_hits=1)
    pos = (10.0, 5.0, 1.0)
    for _ in range(8):
        objects = tracker.update([_det(0, pos)])

    assert len(objects) == 1
    assert objects[0]["is_dynamic"] is False


def test_moving_object_is_classified_dynamic_after_min_frames():
    tracker = MultiObjectTracker(velocity_threshold=0.3, min_frames_for_decision=5, min_hits=1)
    for i in range(8):
        pos = (10.0 + i * 1.0, 5.0, 1.0)  # 1 m/frame, well above the 0.3 threshold
        objects = tracker.update([_det(0, pos, cls=DYNAMIC_VEHICLE)])

    assert len(objects) == 1
    assert objects[0]["is_dynamic"] is True


def test_is_dynamic_is_undecided_before_min_frames():
    tracker = MultiObjectTracker(velocity_threshold=0.3, min_frames_for_decision=5, min_hits=1)
    for i in range(3):
        pos = (10.0 + i * 1.0, 5.0, 1.0)
        tracker.update([_det(0, pos, cls=DYNAMIC_VEHICLE)])

    track = tracker.tracks[0]
    assert track.is_dynamic(velocity_threshold=0.3, min_frames=5) is None


def test_track_id_persists_across_frames_for_same_object():
    tracker = MultiObjectTracker(min_hits=1)
    ids_seen = []
    for i in range(5):
        pos = (10.0 + i * 0.5, 5.0, 1.0)
        objects = tracker.update([_det(0, pos)])
        ids_seen.append(objects[0]["track_id"])

    assert len(set(ids_seen)) == 1, "the same physical object must keep one persistent track id"


def test_new_detection_spawns_a_new_track_not_hijack_an_existing_one():
    tracker = MultiObjectTracker(min_hits=1, max_match_distance=3.0)
    tracker.update([_det(0, (0.0, 0.0, 0.0))])
    # a second object appears far away -- must not be associated with track 0
    objects = tracker.update([_det(0, (0.0, 0.0, 0.0)), _det(1, (50.0, 50.0, 0.0))])

    assert len(objects) == 2
    assert len({o["track_id"] for o in objects}) == 2


def test_two_simultaneous_objects_keep_distinct_ids_via_hungarian_association():
    tracker = MultiObjectTracker(min_hits=1)
    objects = tracker.update([_det(0, (0.0, 0.0, 0.0)), _det(1, (20.0, 0.0, 0.0))])
    id_a = next(o["track_id"] for o in objects if o["position"][0] < 10)
    id_b = next(o["track_id"] for o in objects if o["position"][0] >= 10)

    for i in range(1, 5):
        objects = tracker.update([
            _det(0, (0.0 + i * 0.1, 0.0, 0.0)),
            _det(1, (20.0 - i * 0.1, 0.0, 0.0)),
        ])

    got_a = next(o["track_id"] for o in objects if o["position"][0] < 10)
    got_b = next(o["track_id"] for o in objects if o["position"][0] >= 10)
    assert got_a == id_a
    assert got_b == id_b


def test_track_drops_after_max_age_missed_frames():
    tracker = MultiObjectTracker(min_hits=1, max_age=2)
    tracker.update([_det(0, (0.0, 0.0, 0.0))])
    assert len(tracker.tracks) == 1

    tracker.update([])
    tracker.update([])
    tracker.update([])
    assert len(tracker.tracks) == 0, "a track with no matching detection for max_age frames must be dropped"


def test_to_tracked_object_matches_shared_schema_shape():
    tracker = MultiObjectTracker(min_hits=1)
    objects = tracker.update([_det(0, (1.0, 2.0, 3.0), cls=DYNAMIC_VEHICLE, conf=0.75)])

    assert len(objects) == 1
    obj = objects[0]
    assert set(obj.keys()) == {"track_id", "cls", "position", "velocity", "velocity_relative", "is_dynamic", "confidence"}
    assert isinstance(obj["track_id"], int)
    assert obj["cls"] in (STATIC_OBSTACLE_WALL, DYNAMIC_VEHICLE)
    assert len(obj["position"]) == 3
    assert len(obj["velocity"]) == 3
    assert len(obj["velocity_relative"]) == 3
    assert isinstance(obj["is_dynamic"], bool)
    assert 0.0 <= obj["confidence"] <= 1.0


def test_ego_motion_compensation_recovers_true_stationary_object():
    """A track whose RAW (ego-frame) position drifts only because the ego
    vehicle itself is moving must be classified as static once EgoOdometry's
    ego_velocity is supplied and compensation applied -- this is the exact
    scenario interfaces.md v2 SS6 introduces EgoOdometry to fix."""
    tracker = MultiObjectTracker(velocity_threshold=0.3, min_frames_for_decision=5, min_hits=1)
    ego_velocity = (2.0, 0.0)  # ego vehicle moving forward at 2 m/s
    for i in range(8):
        # object's raw ego-frame position drifts backward at exactly the
        # ego vehicle's own speed -- i.e. it is REALLY stationary in the world
        pos = (10.0 - i * 2.0, 5.0, 1.0)
        objects = tracker.update([_det(0, pos)], ego_velocity=ego_velocity)

    assert len(objects) == 1
    assert objects[0]["is_dynamic"] is False, \
        "a world-stationary object must not be misclassified as dynamic just because the ego vehicle is moving"
    assert np.allclose(objects[0]["velocity"], (0.0, 0.0, 0.0), atol=0.35), \
        "compensated velocity should be near zero"
    assert not np.allclose(objects[0]["velocity_relative"], (0.0, 0.0, 0.0), atol=0.35), \
        "raw/relative velocity should still show the apparent motion, uncompensated"
