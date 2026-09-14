import importlib
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(BACKEND_ROOT))
for p in (BACKEND_ROOT, REPO_ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A TestClient for a freshly-imported main.py, with an isolated JWT
    secret/credentials/audit log so this suite never touches the real dev
    security/.env or security/audit.log, and gets deterministic demo
    passwords regardless of the developer's machine-level env vars."""
    monkeypatch.setenv("RAKSHASETU_JWT_SECRET", "test-secret-not-for-real-use")
    monkeypatch.setenv("RAKSHASETU_ADMIN_PASSWORD", "test-admin-pw")
    monkeypatch.setenv("RAKSHASETU_VIEWER_PASSWORD", "test-viewer-pw")
    monkeypatch.setenv("RAKSHASETU_AUDIT_LOG_PATH", str(tmp_path / "audit.log"))

    import security.auth as auth_module
    import security.audit as audit_module
    importlib.reload(auth_module)
    importlib.reload(audit_module)

    import main as main_module
    importlib.reload(main_module)  # picks up the reloaded auth/audit modules above

    from fastapi.testclient import TestClient
    with TestClient(main_module.app) as c:
        yield c

    importlib.reload(auth_module)
    importlib.reload(audit_module)


@pytest.fixture
def admin_token(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "test-admin-pw"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.fixture
def viewer_token(client):
    resp = client.post("/api/auth/login", json={"username": "viewer", "password": "test-viewer-pw"})
    assert resp.status_code == 200
    return resp.json()["access_token"]
