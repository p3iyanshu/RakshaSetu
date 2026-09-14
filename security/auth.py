"""
RakshaSetu security module -- shared JWT auth + RBAC.

Used by the dashboard backend (dashboard/backend/main.py) to require a
valid token before the WebSocket handshake completes, and to gate
admin-only actions behind a role check. This is the "security-by-design"
piece of Member 6's brief: two fixed roles (viewer / admin), demo
credentials from environment variables -- never hardcoded/committed -- and
short-lived JWT bearer tokens. It is honestly scoped as a hackathon
prototype's auth layer, not a certified defence-grade auth system.
"""
import os
import secrets
import time
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from jose import JWTError, jwt

HERE = Path(__file__).resolve().parent
ENV_PATH = HERE / ".env"
load_dotenv(ENV_PATH)  # local-only, gitignored -- never committed

ROLE_VIEWER = "viewer"
ROLE_ADMIN = "admin"
VALID_ROLES = (ROLE_VIEWER, ROLE_ADMIN)

ALGORITHM = "HS256"
TOKEN_EXPIRY_SECONDS = 8 * 3600  # one demo/shift session

# Using the `bcrypt` package directly rather than passlib's CryptContext:
# passlib hasn't been updated since 2020 and its version-sniffing for the
# bcrypt backend breaks on bcrypt>=4.1 (which dropped the `__about__`
# attribute passlib probes for) -- a known upstream incompatibility, not
# something worth working around here.


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def _verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))


def _get_or_create_secret() -> str:
    """Reads RAKSHASETU_JWT_SECRET from the environment/.env; if absent,
    generates one and persists it to the local .env so restarts (including
    `uvicorn --reload`) don't invalidate every session, without ever
    committing a real secret to git. This is the fix for the exact pitfall
    the team's own brief warns about: a hardcoded JWT secret in the repo."""
    secret = os.environ.get("RAKSHASETU_JWT_SECRET")
    if secret:
        return secret

    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("RAKSHASETU_JWT_SECRET="):
                return line.split("=", 1)[1].strip()

    secret = secrets.token_hex(32)
    with open(ENV_PATH, "a", encoding="utf-8") as f:
        f.write(f"RAKSHASETU_JWT_SECRET={secret}\n")
    print(
        f"[security.auth] No RAKSHASETU_JWT_SECRET set -- generated a dev-only "
        f"secret and stored it in {ENV_PATH} (gitignored). Set the env var "
        f"explicitly before any real deployment."
    )
    return secret


JWT_SECRET = _get_or_create_secret()

# Demo credentials -- env-overridable. These defaults exist so the dashboard
# is demoable out of the box; set RAKSHASETU_ADMIN_PASSWORD /
# RAKSHASETU_VIEWER_PASSWORD before showing this to anyone outside the team.
_DEFAULT_PASSWORDS = {"admin": "admin123", "viewer": "viewer123"}
_ROLE_BY_USERNAME = {"admin": ROLE_ADMIN, "viewer": ROLE_VIEWER}


def _build_user_table():
    table = {}
    for username, role in _ROLE_BY_USERNAME.items():
        env_key = f"RAKSHASETU_{username.upper()}_PASSWORD"
        password = os.environ.get(env_key)
        if not password:
            password = _DEFAULT_PASSWORDS[username]
            print(
                f"[security.auth] Using default demo password for '{username}' -- "
                f"set {env_key} before any real deployment."
            )
        table[username] = {"password_hash": _hash_password(password), "role": role}
    return table


_USERS = _build_user_table()
_DUMMY_HASH = _hash_password("not-a-real-account")


def authenticate(username: str, password: str):
    """Returns the role string on success, None on bad credentials. Always
    runs a bcrypt verify even for an unknown username, so a login attempt
    against a nonexistent account doesn't return measurably faster than one
    against a real account with a wrong password."""
    user = _USERS.get(username)
    if not user:
        _verify_password(password, _DUMMY_HASH)
        return None
    if not _verify_password(password, user["password_hash"]):
        return None
    return user["role"]


def create_access_token(username: str, role: str) -> str:
    now = int(time.time())
    payload = {"sub": username, "role": role, "iat": now, "exp": now + TOKEN_EXPIRY_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jose.JWTError on invalid, expired, or malformed tokens."""
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    if payload.get("role") not in VALID_ROLES:
        raise JWTError("unknown role in token")
    return payload
