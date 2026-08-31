# Member 5 — Dashboard & Visualization Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** the real-time dashboard that shows the live 2.5D map, color-coded by class, plus performance metrics — this is what judges will actually watch during the demo.

---

## Your mission

Build a live dashboard that streams and renders the fused occupancy-semantic map from Member 4's pipeline, color-coded (green = drivable, red = static obstacle, yellow = dynamic object), alongside live metrics: FPS, latency, mIoU, compute savings.

## You do NOT need to wait for the real pipeline

Build the entire UI against a **mock JSON feed** matching the agreed schema (ask Member 4 for `interfaces.md` in week 1) — generate fake grid + object data yourself and stream it locally. Swap in the real WebSocket feed only at the end. This is the single biggest time-saver available to you: your whole frontend can be finished before the backend pipeline even runs.

---

## Task breakdown

### 1. Backend — FastAPI + WebSocket
```python
from fastapi import FastAPI, WebSocket

app = FastAPI()

@app.websocket("/ws/live-feed")
async def live_feed(websocket: WebSocket):
    await websocket.accept()
    while True:
        frame_data = get_latest_fused_frame()   # from Member 4's fusion node, or your mock generator
        await websocket.send_json(frame_data)
```
Agree on the exact JSON shape with Member 4 — grid cells, object list, and metrics (latency, FPS, mIoU, compute savings %) all need to be in one consistent payload per frame.

### 2. Mock data generator (build this first)
```python
import random

def mock_frame():
    return {
        "grid": [
            {"ring": r, "angular_bin": a, "class": random.choice([0,1,2]), "height_mean": random.uniform(0,1)}
            for r in range(4) for a in range(0, 360, 10)
        ],
        "objects": [
            {"track_id": i, "class": random.choice([1,2]), "position": [random.uniform(-50,50), random.uniform(-50,50)], "is_dynamic": bool(random.getrandbits(1))}
            for i in range(5)
        ],
        "metrics": {"fps": 42, "latency_ms": 24, "miou": 0.914, "compute_savings_pct": 63},
    }
```
Point your frontend at this before the real pipeline exists.

### 3. Frontend — rendering the map
Use Three.js or deck.gl to render the grid as a top-down (bird's-eye) view:
- Color each cell by class: green (drivable), red (static obstacle), yellow (dynamic object)
- Render tracked objects as bounding boxes/icons on top of the grid, with a short motion trail for dynamic ones
- Keep the resolution difference visible — cells should visibly get larger toward the edges, not just change color, since that's the actual point being demonstrated

### 4. Metrics panel
Live-updating stat tiles: FPS, latency (ms), segmentation accuracy (mIoU), compute savings vs. uniform grid (%). Pull these numbers from the same WebSocket payload — don't hardcode them, since Member 6 will be benchmarking real numbers you need to display live.

### 5. Visual consistency with the pitch deck
Match the dark-mode, green/red/yellow color language already established in the deck's images — this makes the live demo feel like a continuation of the pitch, not a different product.

### 6. Swap mock for live feed
Once Member 4's pipeline is producing real frames, point your existing WebSocket client at the real endpoint. If your frontend was built strictly against the agreed schema, this should be close to a one-line change.

---

## Interface contract

**You receive from Member 4:** a WebSocket stream of JSON frames — grid cells, tracked objects, live metrics (schema agreed in week 1)
**You deliver to:** the live demo itself — this is the last stop in the pipeline, so your output is what gets shown to judges

## Tools
FastAPI, WebSockets, React, Three.js or deck.gl.

## Timeline
- **Week 1**: mock data generator + WebSocket backend skeleton done, schema agreed with Member 4
- **Weeks 2–3**: full frontend built against the mock feed — grid rendering, object overlays, metrics panel
- **Week 4**: swap mock feed for Member 4's real pipeline output
- **Week 5**: visual polish, make sure it matches the deck's established look for the live demo

## Deliverables checklist
- [ ] Mock data generator matching the agreed schema
- [ ] FastAPI + WebSocket backend
- [ ] Frontend rendering the color-coded grid with visibly varying cell sizes
- [ ] Tracked object overlays with motion trails
- [ ] Live metrics panel (FPS, latency, mIoU, compute savings %)
- [ ] Swapped from mock to live pipeline feed
