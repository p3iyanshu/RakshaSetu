"""
Unit tests for security/auth.py -- JWT creation/verification and RBAC.

Run: pytest security/tests/test_auth.py -v
"""
import time

import pytest
from jose import JWTError


def test_authenticate_correct_credentials_returns_role(fresh_auth):
    assert fresh_auth.authenticate("admin", "test-admin-pw") == fresh_auth.ROLE_ADMIN
    assert fresh_auth.authenticate("viewer", "test-viewer-pw") == fresh_auth.ROLE_VIEWER


def test_authenticate_wrong_password_returns_none(fresh_auth):
    assert fresh_auth.authenticate("admin", "wrong-password") is None


def test_authenticate_unknown_username_returns_none(fresh_auth):
    assert fresh_auth.authenticate("nobody", "anything") is None


def test_authenticate_unknown_user_still_runs_a_bcrypt_verify(fresh_auth, monkeypatch):
    """The dummy-hash check for unknown usernames exists specifically to
    avoid a timing side-channel that reveals whether a username is valid.
    Assert the code path is actually taken (verify_password called) rather
    than short-circuited."""
    calls = []
    real_verify = fresh_auth._verify_password

    def spy(password, password_hash):
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(fresh_auth, "_verify_password", spy)
    fresh_auth.authenticate("nobody", "anything")
    assert calls == [fresh_auth._DUMMY_HASH]


def test_create_and_decode_token_round_trip(fresh_auth):
    token = fresh_auth.create_access_token("admin", fresh_auth.ROLE_ADMIN)
    payload = fresh_auth.decode_token(token)
    assert payload["sub"] == "admin"
    assert payload["role"] == fresh_auth.ROLE_ADMIN


def test_decode_token_rejects_garbage(fresh_auth):
    with pytest.raises(JWTError):
        fresh_auth.decode_token("not-a-real-token")


def test_decode_token_rejects_expired_token(fresh_auth):
    now = int(time.time())
    from jose import jwt as jose_jwt
    expired_payload = {"sub": "admin", "role": fresh_auth.ROLE_ADMIN, "iat": now - 100, "exp": now - 1}
    expired_token = jose_jwt.encode(expired_payload, fresh_auth.JWT_SECRET, algorithm=fresh_auth.ALGORITHM)
    with pytest.raises(JWTError):
        fresh_auth.decode_token(expired_token)


def test_decode_token_rejects_tampered_signature(fresh_auth):
    token = fresh_auth.create_access_token("admin", fresh_auth.ROLE_ADMIN)
    tampered = token[:-4] + ("AAAA" if token[-4:] != "AAAA" else "BBBB")
    with pytest.raises(JWTError):
        fresh_auth.decode_token(tampered)


def test_decode_token_rejects_unknown_role(fresh_auth):
    from jose import jwt as jose_jwt
    now = int(time.time())
    forged = {"sub": "admin", "role": "superadmin", "iat": now, "exp": now + 3600}
    forged_token = jose_jwt.encode(forged, fresh_auth.JWT_SECRET, algorithm=fresh_auth.ALGORITHM)
    with pytest.raises(JWTError):
        fresh_auth.decode_token(forged_token)


def test_token_signed_with_different_secret_is_rejected(fresh_auth):
    """Guards against a weak/mismatched secret silently being accepted."""
    from jose import jwt as jose_jwt
    now = int(time.time())
    payload = {"sub": "admin", "role": fresh_auth.ROLE_ADMIN, "iat": now, "exp": now + 3600}
    token_from_other_secret = jose_jwt.encode(payload, "a-completely-different-secret", algorithm=fresh_auth.ALGORITHM)
    with pytest.raises(JWTError):
        fresh_auth.decode_token(token_from_other_secret)


def test_password_hashes_are_never_plaintext(fresh_auth):
    for user in fresh_auth._USERS.values():
        assert user["password_hash"] != "test-admin-pw"
        assert user["password_hash"] != "test-viewer-pw"
        assert user["password_hash"].startswith("$2b$") or user["password_hash"].startswith("$2a$")
