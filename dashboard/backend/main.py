"""
RakshaSetu dashboard backend -- FastAPI + WebSocket live feed.

Serves the fused occupancy-semantic map (adaptive polar grid + tracked
objects + live metrics) to the dashboard frontend.

Data source, chosen fresh on every connection:
  1. dashboard/backend/data/demo_sequence.json, if present and valid --
     the real pipeline output (segmentation model + tracker run on real
     SemanticKITTI frames). Looped, replaying each frame's own relative
     timestamp deltas so playback speed matches how it was recorded.
  2. Otherwise, a live mock generator producing frames in the exact same
     shape, so the dashboard is always demoable.

Run: uvicorn main:app --reload --port 8000   (from dashboard/backend/)
"""
import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from mock_generator import MockFeedGenerator
from real_feed import try_load_real_sequence

HERE = os.path.dirname(os.path.abspath(__file__))
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


def _current_source():
    """Re-checks the real data file on every call -- this is what gives us
    'automatically pick up the real file once it appears' without needing a
    server restart, at the cost of a fresh connection to see it."""
    real = try_load_real_sequence(REAL_DATA_PATH)
    if real is not None:
        return "real", real
    return "mock", None


@app.get("/api/health")
def health():
    mode, real = _current_source()
    return {
        "status": "ok",
        "mode": mode,
        "num_frames": len(real["frames"]) if real else None,
    }


@app.get("/api/initial-state")
def initial_state():
    """One-shot snapshot so the UI can paint before the WebSocket connects."""
    mode, real = _current_source()
    if mode == "real":
        meta = dict(real["meta"])
        meta["mode"] = "real"
        return {"meta": meta, "frame": real["frames"][0]}
    meta = dict(_mock.meta)
    meta["mode"] = "mock"
    return {"meta": meta, "frame": _mock.next_frame()}


@app.websocket("/ws/live-feed")
async def live_feed(websocket: WebSocket):
    await websocket.accept()
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
        await websocket.send_json({"type": "frame", "frame": frame})

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
        await websocket.send_json({"type": "frame", "frame": frame})
        await asyncio.sleep(MOCK_FRAME_DELAY)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
