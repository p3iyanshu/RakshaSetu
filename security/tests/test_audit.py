"""
Unit tests for security/audit.py -- the structured JSON-Lines audit trail.

Run: pytest security/tests/test_audit.py -v
"""
import importlib
import json

import pytest


@pytest.fixture
def audit(tmp_path, monkeypatch):
    """Points the audit module at a scratch log file for the duration of
    the test, so tests never append to the real security/audit.log."""
    log_path = tmp_path / "audit.log"
    monkeypatch.setenv("RAKSHASETU_AUDIT_LOG_PATH", str(log_path))
    import security.audit as audit_module
    importlib.reload(audit_module)
    yield audit_module
    importlib.reload(audit_module)


def test_log_action_writes_one_json_line(audit):
    audit.log_action("login", username="admin", role="admin", outcome="success")
    events = audit.read_recent()
    assert len(events) == 1
    e = events[0]
    assert e["action"] == "login"
    assert e["username"] == "admin"
    assert e["role"] == "admin"
    assert e["outcome"] == "success"
    assert "timestamp" in e


def test_log_action_default_outcome_is_success(audit):
    audit.log_action("ws.connect", username="viewer", role="viewer")
    assert audit.read_recent()[0]["outcome"] == "success"


def test_log_action_records_detail_dict(audit):
    audit.log_action("admin.feed_mode", username="admin", role="admin",
                      detail={"requested_mode": "real", "effective_mode": "mock"})
    e = audit.read_recent()[0]
    assert e["detail"] == {"requested_mode": "real", "effective_mode": "mock"}


def test_log_action_handles_unauthenticated_attempt(audit):
    audit.log_action("login", outcome="denied", detail={"username": "bad-actor"})
    e = audit.read_recent()[0]
    assert e["username"] is None
    assert e["outcome"] == "denied"


def test_read_recent_preserves_order(audit):
    for i in range(5):
        audit.log_action(f"action-{i}")
    events = audit.read_recent()
    assert [e["action"] for e in events] == [f"action-{i}" for i in range(5)]


def test_read_recent_respects_limit(audit):
    for i in range(10):
        audit.log_action(f"action-{i}")
    events = audit.read_recent(limit=3)
    assert len(events) == 3
    assert [e["action"] for e in events] == ["action-7", "action-8", "action-9"]


def test_read_recent_on_missing_file_returns_empty(audit):
    assert audit.read_recent() == []


def test_each_line_is_independently_valid_json(audit, tmp_path):
    audit.log_action("a")
    audit.log_action("b")
    log_path = tmp_path / "audit.log"
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    for line in lines:
        json.loads(line)  # raises if malformed


def test_read_recent_skips_corrupt_lines(audit, tmp_path):
    audit.log_action("good-1")
    log_path = tmp_path / "audit.log"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write("not valid json\n")
    audit.log_action("good-2")
    events = audit.read_recent()
    assert [e["action"] for e in events] == ["good-1", "good-2"]
