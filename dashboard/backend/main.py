"""
RakshaSetu dashboard backend -- FastAPI + WebSocket live feed.

Serves the fused occupancy-semantic map (adaptive polar grid + tracked
objects + live metrics) to the dashboard frontend.

Data source, chosen fresh on every connection (or forced by an admin via
/api/admin/feed-mode -- see below):
  1. dashboard/backend/data/demo_sequence.json, if present and valid --
     the real pipeline output (segmentation model + tracker run on real
     SemanticKITTI frames). Looped, replaying each frame's own relative
     timestamp deltas so playback speed matches how it was recorded.
  2. Otherwise, a live mock generator producing frames in the exact same
     shape, so the dashboard is always demoable.

Auth: every endpoint below (except /api/health) requires a JWT bearer
token from security/auth.py -- viewer role can watch, admin role can also
call /api/admin/*. Get a token from POST /api/auth/login. The WebSocket
can't send custom headers, so it takes the token as a `?token=` query
param instead and is rejected before the handshake completes if it's
missing or invalid.

Run (plain HTTP, local dev):
  uvicorn main:app --reload --port 8000   (from dashboard/backend/)

Run over TLS (wss://), once security/generate_certs.sh has been run:
  uvicorn main:app --reload --port 8000 \
    --ssl-keyfile ../../security/certs/dev-key.pem \
    --ssl-certfile ../../security/certs/dev-cert.pem
"""
import asyncio
import math
import os
import sys
from typing import Literal, Optional

import psutil
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError
from pydantic import BaseModel

from mock_generator import MockFeedGenerator
from real_feed import try_load_real_sequence

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from security import audit, auth  # noqa: E402 -- must follow sys.path setup above

REAL_DATA_PATH = os.path.join(HERE, "data", "demo_sequence.json")

MIN_FRAME_DELAY = 0.03   # seconds -- never replay faster than this
MAX_FRAME_DELAY = 0.5    # seconds -- never stall longer than this between frames
MOCK_FRAME_DELAY = 0.1   # ~10 fps for the synthetic feed

app = FastAPI(title="RakshaSetu Dashboard Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One shared mock generator instance so the REST snapshot and any mock
# WebSocket connections advance through the same evolving scene.
_mock = MockFeedGenerator()

# Admin override for which source to serve, set via /api/admin/feed-mode.
# None means "auto" -- the original real-if-present-else-mock behavior.
_forced_mode: Optional[Literal["real", "mock"]] = None

# This backend process's own RSS -- real, live, and necessarily computed at
# serve time (not something the offline precompute could have baked into
# demo_sequence.json, since that would be the precompute script's memory
# usage, not this server's). Live Perception's MEMORY USAGE stat reads this.
_this_process = psutil.Process()


def _with_live_metrics(frame: dict) -> dict:
    frame = dict(frame)
    metrics = dict(frame.get("metrics") or {})
    metrics["memory_mb"] = _this_process.memory_info().rss / 1e6
    frame["metrics"] = metrics
    return frame


# ---------------------------------------------------------------------------
# Auth / RBAC
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def require_role(*allowed_roles: str):
    """FastAPI dependency factory: with no args, any valid token passes
    (viewer or admin); with roles given, only those roles pass."""

    def dependency(authorization: Optional[str] = Header(None)) -> dict:
        token = _extract_bearer_token(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        try:
            payload = auth.decode_token(token)
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        if allowed_roles and payload["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient role for this action")
        return payload

    return dependency


@app.post("/api/auth/login", response_model=LoginResponse)
def login(req: LoginRequest):
    role = auth.authenticate(req.username, req.password)
    if role is None:
        audit.log_action("login", username=req.username, outcome="denied")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = auth.create_access_token(req.username, role)
    audit.log_action("login", username=req.username, role=role, outcome="success")
    return LoginResponse(access_token=token, role=role, username=req.username)


# ---------------------------------------------------------------------------
# Input validation -- defensive sanitization at the wire boundary. Real
# per-point NaN/Inf rejection belongs further upstream (Member 4's ingest
# node, on raw LiDAR points); this is the dashboard's own last-line check
# on whatever frame it's about to serve, per the "reject NaN/Inf
# coordinates or implausible point counts" item in Member 6's brief.
# ---------------------------------------------------------------------------

MAX_PLAUSIBLE_POINT_COUNT = 100_000


def _finite(value, default=0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def _sanitize_frame(frame: dict) -> dict:
    grid = []
    for cell in frame.get("grid", []):
        c = dict(cell)
        c["height_max"] = _finite(c.get("height_max"))
        c["height_mean"] = _finite(c.get("height_mean"))
        c["confidence"] = min(1.0, max(0.0, _finite(c.get("confidence"))))
        try:
            point_count = int(c.get("point_count", 0))
        except (TypeError, ValueError):
            point_count = 0
        c["point_count"] = max(0, min(point_count, MAX_PLAUSIBLE_POINT_COUNT))
        grid.append(c)

    objects = []
    for obj in frame.get("objects", []):
        o = dict(obj)
        position = o.get("position") or []
        o["position"] = [_finite(v) for v in position] or [0.0, 0.0, 0.0]
        velocity = o.get("velocity") or []
        o["velocity"] = [_finite(v) for v in velocity] or [0.0, 0.0]
        o["confidence"] = min(1.0, max(0.0, _finite(o.get("confidence"))))
        objects.append(o)

    metrics = dict(frame.get("metrics") or {})
    for key in ("fps", "latency_ms", "miou", "compute_savings_pct", "memory_mb"):
        if key in metrics:
            metrics[key] = _finite(metrics[key])

    out = dict(frame)
    out["grid"] = grid
    out["objects"] = objects
    out["metrics"] = metrics
    return out


# ---------------------------------------------------------------------------
# Feed source selection
# ---------------------------------------------------------------------------

def _current_source():
    """Re-checks the real data file on every call -- this is what gives us
    'automatically pick up the real file once it appears' without needing a
    server restart, at the cost of a fresh connection to see it. An admin
    can override this via /api/admin/feed-mode."""
    if _forced_mode == "mock":
        return "mock", None

    real = try_load_real_sequence(REAL_DATA_PATH)
    if _forced_mode == "real":
        return ("real", real) if real is not None else ("mock", None)

    if real is not None:
        return "real", real
    return "mock", None


@app.get("/api/health")
def health():
    """Intentionally unauthenticated -- a health probe shouldn't need a
    token, and it leaks nothing sensitive."""
    mode, real = _current_source()
    return {
        "status": "ok",
        "mode": mode,
        "forced_mode": _forced_mode,
        "num_frames": len(real["frames"]) if real else None,
    }


@app.get("/api/initial-state")
def initial_state(_claims: dict = Depends(require_role())):
    """One-shot snapshot so the UI can paint before the WebSocket connects."""
    mode, real = _current_source()
    if mode == "real":
        meta = dict(real["meta"])
        meta["mode"] = "real"
        return {"meta": meta, "frame": _sanitize_frame(_with_live_metrics(real["frames"][0]))}
    meta = dict(_mock.meta)
    meta["mode"] = "mock"
    return {"meta": meta, "frame": _sanitize_frame(_with_live_metrics(_mock.next_frame()))}


# ---------------------------------------------------------------------------
# Admin-only controls (RBAC: viewer can watch, admin can also do this)
# ---------------------------------------------------------------------------

class FeedModeRequest(BaseModel):
    mode: Literal["auto", "real", "mock"]


@app.post("/api/admin/feed-mode")
def set_feed_mode(req: FeedModeRequest, claims: dict = Depends(require_role(auth.ROLE_ADMIN))):
    global _forced_mode
    _forced_mode = None if req.mode == "auto" else req.mode
    mode, _ = _current_source()
    audit.log_action(
        "admin.feed_mode", username=claims["sub"], role=claims["role"],
        detail={"requested_mode": req.mode, "effective_mode": mode},
    )
    return {"forced_mode": _forced_mode, "effective_mode": mode}


@app.post("/api/admin/reset-mock")
def reset_mock(claims: dict = Depends(require_role(auth.ROLE_ADMIN))):
    global _mock
    _mock = MockFeedGenerator()
    audit.log_action("admin.reset_mock", username=claims["sub"], role=claims["role"])
    return {"status": "reset"}


@app.get("/api/admin/audit-log")
def get_audit_log(limit: int = 100, _claims: dict = Depends(require_role(auth.ROLE_ADMIN))):
    """Admin-only view of the audit trail -- lets a judge/teammate see the
    demo's own security log without shelling into the server."""
    return {"events": audit.read_recent(limit=limit)}


# ---------------------------------------------------------------------------
# Live feed
# ---------------------------------------------------------------------------

@app.websocket("/ws/live-feed")
async def live_feed(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        audit.log_action("ws.connect", outcome="denied", detail={"reason": "missing token"})
        await websocket.close(code=4401)
        return
    try:
        claims = auth.decode_token(token)
    except JWTError:
        audit.log_action("ws.connect", outcome="denied", detail={"reason": "invalid or expired token"})
        await websocket.close(code=4401)
        return

    await websocket.accept()
    audit.log_action("ws.connect", username=claims["sub"], role=claims["role"], outcome="success")
    mode, real = _current_source()
    try:
        if mode == "real":
            await _stream_real(websocket, real)
        else:
            await _stream_mock(websocket)
    except WebSocketDisconnect:
        return


async def _stream_real(websocket: WebSocket, real: dict):
    meta = dict(real["meta"])
    meta["mode"] = "real"
    await websocket.send_json({"type": "meta", "meta": meta})

    frames = real["frames"]
    n = len(frames)
    i = 0
    # fallback gap used when looping back from the last frame to the first,
    # or when timestamps don't increase monotonically
    default_gap = MOCK_FRAME_DELAY
    if n > 1:
        try:
            default_gap = max(MIN_FRAME_DELAY, min(MAX_FRAME_DELAY, float(frames[1]["timestamp"]) - float(frames[0]["timestamp"])))
        except (TypeError, ValueError, KeyError):
            pass

    while True:
        frame = frames[i]
        await websocket.send_json({"type": "frame", "frame": _sanitize_frame(_with_live_metrics(frame))})

        nxt = frames[(i + 1) % n]
        try:
            delta = float(nxt["timestamp"]) - float(frame["timestamp"])
        except (TypeError, ValueError, KeyError):
            delta = default_gap
        if delta <= 0:
            delta = default_gap
        delay = max(MIN_FRAME_DELAY, min(MAX_FRAME_DELAY, delta))

        await asyncio.sleep(delay)
        i = (i + 1) % n


async def _stream_mock(websocket: WebSocket):
    meta = dict(_mock.meta)
    meta["mode"] = "mock"
    await websocket.send_json({"type": "meta", "meta": meta})
    while True:
        frame = _mock.next_frame()
        await websocket.send_json({"type": "frame", "frame": _sanitize_frame(_with_live_metrics(frame))})
        await asyncio.sleep(MOCK_FRAME_DELAY)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
