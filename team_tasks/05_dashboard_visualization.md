# Member 5 — Dashboard & Visualization Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** the real-time dashboard that shows the live 2.5D map, color-coded by class, plus performance metrics — this is what judges will actually watch during the demo.

---

## Your mission

Build a live dashboard that streams and renders the fused occupancy-semantic map from Member 4's pipeline, color-coded by class (green = drivable; two red shades for the static wall/pole split; two amber/orange shades for the dynamic vehicle/pedestrian split; neutral gray for other/unknown — see `dashboard/frontend/src/lib/colors.js`, already built), alongside live metrics: FPS, latency, mIoU, compute savings.

## You do NOT need to wait for the real pipeline

Build the entire UI against a **mock JSON feed** matching the agreed schema (ask Member 4 for `interfaces.md` in week 1) — generate fake grid + object data yourself and stream it locally. Swap in the real WebSocket feed only at the end. This is the single biggest time-saver available to you: your whole frontend can be finished before the backend pipeline even runs.

---

## Setup — get your environment ready

```bash
# backend
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS/Linux:            source .venv/bin/activate
pip install fastapi "uvicorn[standard]" websockets

# frontend
npm install
```
Run both, in two terminals:
```bash
uvicorn main:app --reload --port 8000        # backend, from dashboard/backend
npm run dev                                   # frontend, from dashboard/frontend (defaults to :5173)
```
**CORS gotcha:** the Vite dev server (`:5173`) and the FastAPI backend (`:8000`) are different origins during development — add `fastapi.middleware.cors.CORSMiddleware` allowing `http://localhost:5173` on the backend, or the browser will silently block the WebSocket connection and you'll see a blank map with no obvious error in your own code.

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

### 2. Mock data generator (build this first) — already done, see `dashboard/backend/mock_generator.py`
```python
import random

def mock_frame():
    return {
        "grid": [
            {"ring": r, "angular_bin": a, "class": random.choice([0,1,2,3,4,5]), "height_mean": random.uniform(0,1)}
            for r in range(4) for a in range(0, 360, 10)
        ],
        "objects": [
            {"track_id": i, "class": random.choice([1,2,3,4]), "position": [random.uniform(-50,50), random.uniform(-50,50)], "is_dynamic": bool(random.getrandbits(1))}
            for i in range(5)
        ],
        "metrics": {"fps": 42, "latency_ms": 24, "miou": 0.914, "compute_savings_pct": 63},
    }
```
Point your frontend at this before the real pipeline exists. **Real implementation note:** the actual `mock_generator.py`/`build_demo_data.py` keep the field name `"ring"` (not `ros2_ws/interfaces.md`'s later `range_bin`) and a flat list of cells (not interfaces.md's string-keyed `"{range_bin}_{angular_bin}"` dict) — this dashboard was built standalone, before that contract existed, per this brief's own "you do not need to wait for the real pipeline" advice. That's fine for now; reconcile the field names once this dashboard actually swaps onto Member 4's real Fusion WebSocket output (Task 6) rather than the offline precompute/mock feed it uses today.

### 3. Frontend — rendering the map
Use Three.js or deck.gl to render the grid as a top-down (bird's-eye) view:
- Color each cell by class (6 classes now, not 3 — see Mission above and `colors.js`)
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

## Common pitfalls

- **No reconnect handling on the WebSocket client.** The backend *will* restart at some point during development (and possibly during a live demo) — if the frontend doesn't detect a dropped connection and retry, the map just silently freezes with no indication anything went wrong.
- **Rendering cell size in a way that doesn't actually look different across rings.** The PS's core ask is a *visible* resolution difference — if your renderer normalizes cell size to fit the screen instead of drawing genuinely larger polygons for far rings, you've hidden the exact thing you're supposed to be demonstrating.
- **Hardcoding metrics instead of reading them from the payload.** It's tempting to put a plausible-looking FPS number in the UI while the mock feed is still in use — replace every hardcoded number with a real field read from the JSON payload before the real feed arrives, or you risk shipping a demo that displays stale numbers nobody actually re-checked.
- **Browser tab throttling.** Some browsers throttle `requestAnimationFrame`/timers in a backgrounded tab — if you're recording a demo or presenting via screen share, make sure the tab stays foregrounded, or animation/metrics updates can visibly stall.
- **CORS/WebSocket origin mismatches** re-appearing after deploying somewhere other than `localhost` — re-check the allowed-origins list whenever the demo moves off your dev machine.

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
