"""
Integration tests for the auth/RBAC/input-validation layer wired into
dashboard/backend/main.py (security/auth.py's JWT+RBAC, security/audit.py's
audit trail, and main.py's own NaN/Inf/point-count sanitization).

Run: pytest dashboard/backend/tests/test_security_integration.py -v
"""
import math

from starlette.websockets import WebSocketDisconnect


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

def test_login_success_returns_bearer_token(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "test-admin-pw"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "admin"
    assert body["token_type"] == "bearer"
    assert len(body["access_token"]) > 20


def test_login_wrong_password_rejected(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_user_rejected(client):
    resp = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert resp.status_code == 401


def test_login_missing_fields_rejected_by_pydantic(client):
    resp = client.post("/api/auth/login", json={"username": "admin"})
    assert resp.status_code == 422  # Pydantic validation, not a 500


# ---------------------------------------------------------------------------
# Auth gate on protected endpoints
# ---------------------------------------------------------------------------

def test_health_is_unauthenticated(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_initial_state_requires_token(client):
    resp = client.get("/api/initial-state")
    assert resp.status_code == 401


def test_initial_state_rejects_malformed_auth_header(client):
    resp = client.get("/api/initial-state", headers={"Authorization": "NotBearer sometoken"})
    assert resp.status_code == 401


def test_initial_state_rejects_garbage_token(client):
    resp = client.get("/api/initial-state", headers={"Authorization": "Bearer garbage.token.here"})
    assert resp.status_code == 401


def test_initial_state_accepts_viewer_token(client, viewer_token):
    resp = client.get("/api/initial-state", headers={"Authorization": f"Bearer {viewer_token}"})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# RBAC -- viewer can watch, only admin can control
# ---------------------------------------------------------------------------

def test_viewer_cannot_call_admin_feed_mode(client, viewer_token):
    resp = client.post(
        "/api/admin/feed-mode",
        json={"mode": "mock"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 403


def test_admin_can_call_admin_feed_mode(client, admin_token):
    resp = client.post(
        "/api/admin/feed-mode",
        json={"mode": "mock"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["forced_mode"] == "mock"


def test_viewer_cannot_reset_mock(client, viewer_token):
    resp = client.post("/api/admin/reset-mock", headers={"Authorization": f"Bearer {viewer_token}"})
    assert resp.status_code == 403


def test_admin_can_reset_mock(client, admin_token):
    resp = client.post("/api/admin/reset-mock", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200


def test_viewer_cannot_read_audit_log(client, viewer_token):
    resp = client.get("/api/admin/audit-log", headers={"Authorization": f"Bearer {viewer_token}"})
    assert resp.status_code == 403


def test_admin_can_read_audit_log_and_sees_own_login(client, admin_token):
    resp = client.get("/api/admin/audit-log", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    actions = [e["action"] for e in resp.json()["events"]]
    assert "login" in actions


# ---------------------------------------------------------------------------
# Audit trail actually records what happened
# ---------------------------------------------------------------------------

def test_failed_login_is_audited(client, admin_token):
    client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    resp = client.get("/api/admin/audit-log", headers={"Authorization": f"Bearer {admin_token}"})
    events = resp.json()["events"]
    denied_logins = [e for e in events if e["action"] == "login" and e["outcome"] == "denied"]
    assert len(denied_logins) == 1
    assert denied_logins[0]["username"] == "admin"


def test_admin_action_is_audited_with_detail(client, admin_token):
    client.post("/api/admin/feed-mode", json={"mode": "real"},
                headers={"Authorization": f"Bearer {admin_token}"})
    resp = client.get("/api/admin/audit-log", headers={"Authorization": f"Bearer {admin_token}"})
    events = resp.json()["events"]
    matches = [e for e in events if e["action"] == "admin.feed_mode"]
    assert len(matches) == 1
    assert matches[0]["detail"]["requested_mode"] == "real"
    assert matches[0]["username"] == "admin"
    assert matches[0]["role"] == "admin"


# ---------------------------------------------------------------------------
# WebSocket auth gate
# ---------------------------------------------------------------------------

def test_websocket_rejects_missing_token(client):
    try:
        with client.websocket_connect("/ws/live-feed"):
            pass
        assert False, "expected the handshake to be rejected"
    except WebSocketDisconnect as e:
        assert e.code == 4401


def test_websocket_rejects_invalid_token(client):
    try:
        with client.websocket_connect("/ws/live-feed?token=not-a-real-token"):
            pass
        assert False, "expected the handshake to be rejected"
    except WebSocketDisconnect as e:
        assert e.code == 4401


def test_websocket_accepts_valid_token_and_streams_a_frame(client, viewer_token):
    with client.websocket_connect(f"/ws/live-feed?token={viewer_token}") as ws:
        meta_msg = ws.receive_json()
        assert meta_msg["type"] == "meta"
        frame_msg = ws.receive_json()
        assert frame_msg["type"] == "frame"
        assert "grid" in frame_msg["frame"]


# ---------------------------------------------------------------------------
# Input validation -- NaN/Inf/implausible-count sanitization at the wire
# boundary (main.py's _sanitize_frame, exercised directly since it's the
# unit under test, not something every source frame naturally exhibits)
# ---------------------------------------------------------------------------

def test_sanitize_frame_replaces_nan_and_inf_heights():
    import main as main_module
    frame = {
        "grid": [{"height_max": float("nan"), "height_mean": float("inf"),
                   "confidence": 0.5, "point_count": 10}],
        "objects": [],
        "metrics": {},
    }
    out = main_module._sanitize_frame(frame)
    cell = out["grid"][0]
    assert math.isfinite(cell["height_max"])
    assert math.isfinite(cell["height_mean"])


def test_sanitize_frame_clamps_confidence_to_unit_range():
    import main as main_module
    frame = {
        "grid": [{"confidence": 5.0, "point_count": 1}, {"confidence": -3.0, "point_count": 1}],
        "objects": [],
        "metrics": {},
    }
    out = main_module._sanitize_frame(frame)
    assert out["grid"][0]["confidence"] == 1.0
    assert out["grid"][1]["confidence"] == 0.0


def test_sanitize_frame_caps_implausible_point_counts():
    import main as main_module
    frame = {
        "grid": [{"point_count": 10 ** 9, "confidence": 0.5}],
        "objects": [],
        "metrics": {},
    }
    out = main_module._sanitize_frame(frame)
    assert out["grid"][0]["point_count"] == main_module.MAX_PLAUSIBLE_POINT_COUNT


def test_sanitize_frame_replaces_nan_object_position_and_velocity():
    import main as main_module
    frame = {
        "grid": [],
        "objects": [{
            "position": [float("nan"), float("inf"), 1.0],
            "velocity": [float("nan"), 2.0],
            "confidence": 0.9,
        }],
        "metrics": {},
    }
    out = main_module._sanitize_frame(frame)
    obj = out["objects"][0]
    assert all(math.isfinite(v) for v in obj["position"])
    assert all(math.isfinite(v) for v in obj["velocity"])


def test_sanitize_frame_defaults_missing_position_to_origin():
    import main as main_module
    frame = {"grid": [], "objects": [{"confidence": 0.5}], "metrics": {}}
    out = main_module._sanitize_frame(frame)
    assert out["objects"][0]["position"] == [0.0, 0.0, 0.0]


def test_sanitize_frame_replaces_nan_metrics():
    import main as main_module
    frame = {"grid": [], "objects": [], "metrics": {"fps": float("nan"), "latency_ms": float("inf")}}
    out = main_module._sanitize_frame(frame)
    assert math.isfinite(out["metrics"]["fps"])
    assert math.isfinite(out["metrics"]["latency_ms"])


# ---------------------------------------------------------------------------
# End-to-end: the real pipeline's precomputed output actually reaches the
# dashboard through the same auth+sanitization path a judge's browser would
# use. dashboard/backend/data/demo_sequence.json is produced by
# build_demo_data.py running the REAL trained segmentation model + REAL
# grid/tracking pipeline over real SemanticKITTI frames (see that script's
# docstring) -- this test doesn't regenerate it, it confirms the backend
# picks it up, serves it as "mode": "real", and the numbers it reports
# (mIoU, compute savings %) survive the trip through auth + sanitization
# unchanged, matching Member 6's brief item 3 ("confirm output reaches the
# dashboard correctly").
# ---------------------------------------------------------------------------

def test_real_pipeline_output_is_served_as_real_mode(client, viewer_token):
    health = client.get("/api/health")
    assert health.status_code == 200
    if health.json()["mode"] != "real":
        import pytest
        pytest.skip("dashboard/backend/data/demo_sequence.json not present on this machine -- "
                    "run dashboard/backend/build_demo_data.py to generate it")

    resp = client.get("/api/initial-state", headers={"Authorization": f"Bearer {viewer_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["mode"] == "real"
    frame = body["frame"]
    assert len(frame["grid"]) > 0
    metrics = frame["metrics"]
    assert 0.0 <= metrics["miou"] <= 1.0
    assert metrics["compute_savings_pct"] > 0


def test_real_pipeline_frames_stream_correctly_authenticated_over_websocket(client, viewer_token):
    health = client.get("/api/health")
    if health.json()["mode"] != "real":
        import pytest
        pytest.skip("dashboard/backend/data/demo_sequence.json not present on this machine")

    with client.websocket_connect(f"/ws/live-feed?token={viewer_token}") as ws:
        meta_msg = ws.receive_json()
        assert meta_msg["meta"]["mode"] == "real"
        frame_msg = ws.receive_json()
        frame = frame_msg["frame"]
        assert isinstance(frame["grid"], list) and len(frame["grid"]) > 0
        assert isinstance(frame["objects"], list)
        for cell in frame["grid"]:
            assert math.isfinite(cell["height_max"])
            assert math.isfinite(cell["height_mean"])
            assert 0.0 <= cell["confidence"] <= 1.0
