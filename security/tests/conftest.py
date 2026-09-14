import importlib
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SECURITY_ROOT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(SECURITY_ROOT)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


@pytest.fixture
def fresh_auth(monkeypatch):
    """Reloads security.auth with a known, isolated env so tests don't
    depend on (or write to) the real dev security/.env, and get
    deterministic demo credentials regardless of what's set on the
    developer's machine."""
    monkeypatch.setenv("RAKSHASETU_JWT_SECRET", "test-secret-not-for-real-use")
    monkeypatch.setenv("RAKSHASETU_ADMIN_PASSWORD", "test-admin-pw")
    monkeypatch.setenv("RAKSHASETU_VIEWER_PASSWORD", "test-viewer-pw")

    import security.auth as auth_module
    importlib.reload(auth_module)
    yield auth_module
    importlib.reload(auth_module)  # restore real env-derived state for any later test/import
