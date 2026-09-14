# RakshaSetu Dashboard

Real-time visualization for the adaptive variable-resolution 2.5D LiDAR
perception pipeline (SIH PS 26053). Streams the fused occupancy-semantic
grid + tracked objects + live metrics from the backend to a single
unified dashboard with three sections: Vehicle HUD, Top-Down LiDAR, and
Web Command Deck.

## Architecture

- **`backend/`** — FastAPI + WebSocket server. Streams one frame at a time
  over `ws://<host>:8000/ws/live-feed`, plus a REST snapshot at
  `GET /api/initial-state` for the very first paint.
- **`frontend/`** — Vite + React + Tailwind SPA. A persistent top nav shell
  (`DashboardLayout`/`TopNav`) owns the one live-feed connection and shares
  it across whichever section is active, routed under `/dashboard/*`.

### Data source (automatic)

On every new connection (REST call or WebSocket connect), the backend
checks `backend/data/demo_sequence.json`:

- **If present and valid** (matches the frame schema below): loops through
  its `frames` array, replaying each frame's own relative `timestamp`
  deltas (clamped to 30ms–500ms per step) so playback speed matches how it
  was recorded, looping seamlessly back to frame 0 at the end.
- **If missing or invalid**: falls back to a live mock generator
  (`backend/mock_generator.py`) that produces frames in the exact same
  shape — a handful of static obstacles (walls/poles) and moving dynamic
  objects (pedestrians/vehicles) binned into the same 4-ring/36-bin polar
  grid, with plausible metrics (fps ~30-45, latency ~20-35ms, mIoU
  ~0.6-0.9, compute savings ~55-70%) — so the dashboard is always
  demoable even before the real pipeline output exists.

A teammate's real pipeline output can drop into
`backend/data/demo_sequence.json` at any time — no backend restart is
needed, just a fresh page load/WebSocket reconnect to pick it up (this repo
already has one committed for the demo, sourced from a SemanticKITTI run).

### Data contract

```json
{
  "meta": {"source": "string", "checkpoint": "string", "num_frames": 100, "generated_at": "iso8601"},
  "frames": [
    {
      "timestamp": 0.0,
      "grid": [ {"ring": 0, "angular_bin": 0, "cls": 0, "height_max": 0.0, "height_mean": 0.0, "point_count": 0, "confidence": 0.0}, "... up to 144 cells (4 rings x 36 angular bins) ..." ],
      "objects": [ {"track_id": 1, "cls": 2, "position": [0.0, 0.0, 0.0], "velocity": [0.0, 0.0], "is_dynamic": true, "confidence": 0.0} ],
      "metrics": {"fps": 0.0, "latency_ms": 0.0, "miou": 0.0, "compute_savings_pct": 0.0}
    }
  ]
}
```

`cls`: 0 = drivable, 1 = static obstacle (wall), 2 = static obstacle
(pole), 3 = dynamic object (vehicle), 4 = dynamic object (human), 5 =
unclassified (see `lib/colors.js`'s `CLASS`/`CLASS_COLOR`). `ring` 0-3 map
to the four adaptive resolution bands: 0-10m@5cm, 10-30m@15cm, 30-60m@30cm,
60-100m@50cm. `angular_bin` is degrees/10 (0-35), angle measured clockwise
from vehicle heading. Tree/curb/pothole/wall-as-such aren't distinct
classes in this contract — the frontend renders those as decorative
roadside props (`lib/live/roadsideProps.js`), not real classifications.

## Running locally

### Backend

```bash
cd dashboard/backend
pip install -r requirements.txt   # fastapi/uvicorn/websockets — already present in this env
uvicorn main:app --reload --port 8000
```

- REST snapshot: `http://localhost:8000/api/initial-state`
- Health/mode check: `http://localhost:8000/api/health` (reports `"mode": "real"` or `"mode": "mock"`)
- WebSocket feed: `ws://localhost:8000/ws/live-feed`

### Frontend

```bash
cd dashboard/frontend
npm install
npm run dev
```

Opens on **`http://localhost:5173`**, redirecting to `/dashboard/lidar`
after sign-in. Sections (picked from the top nav, all under the same
shell):

- **`/dashboard/car`** — Vehicle HUD: forward windshield perspective view
- **`/dashboard/lidar`** — Top-Down LiDAR (default): 360° bird's-eye sweep
- **`/dashboard/admin`** — Web Command Deck (control-room / reviewer view,
  admin role only)

The old top-level `/live`, `/car`, `/admin` paths still redirect into
`/dashboard/*` (`/live` now lands on `/dashboard/lidar`).

The frontend defaults to talking to the backend on `localhost:8000`; set
`VITE_WS_URL` / `VITE_API_URL` env vars to point elsewhere (e.g. viewing
the dashboard from another machine on the LAN).

### Production build

```bash
cd dashboard/frontend
npm run build      # outputs to dashboard/frontend/dist/
npm run preview    # serve the production build locally to sanity-check it
```

## Sections

**Vehicle HUD (`/dashboard/car`)** — forward-perspective windshield view:
a speed readout, gear selector, and mode toggle (DRDO UGV / Civilian
ADAS) up top; the live terrain (drivable green / non-drivable tan) and
tracked objects projected true near-wide/far-narrow below, so the road
reads as a normal receding perspective, not a radar. Discrete obstacles
(wall/pole/vehicle/human/tree/curb/pothole) render as semantic icons, the
same icon set the Top-Down LiDAR view uses.

**Top-Down LiDAR (`/dashboard/lidar`)** — 360° bird's-eye sweep, car fixed
at center pointing "up". Deliberately never rotates the disc based on
heading (there's no real ego-heading in the data contract to justify it,
and an earlier attempt at that looked like the whole scene was spinning);
only the live cell/object data changes frame to frame. A hazard banner
flags the nearest dynamic object within 15m.

**Web Command Deck (`/dashboard/admin`, admin role only)** — richer,
denser layout for reviewers: the feed's `meta` (data source, checkpoint,
live-vs-synthetic badge), a metrics row of stat tiles (FPS, latency, mIoU,
compute savings) each with a live sparkline, the polar grid in a smaller
panel with a class legend and a ring-by-ring cell-size legend, and a full
live table of tracked objects (track ID, class badge, static/dynamic
badge, position, velocity, confidence).

All three sections share one top nav (brand, section tabs, connection
status, clock, sign out) and one live-feed connection, owned by
`DashboardLayout`.
