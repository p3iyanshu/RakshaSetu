# RakshaSetu Dashboard

Vehicle perception dashboard for the adaptive variable-resolution 2.5D
LiDAR pipeline (SIH PS 26053) — the top-down "vehicle is driving and
sees the world" view from `HANDOVER_MEMBER_6_VEHICLE_DASHBOARD.md`.

Originally built at
[github.com/Xxnil-nxX/rsdashboard](https://github.com/Xxnil-nxX/rsdashboard)
and adopted here as the project's dashboard.

## Architecture

Static site, no build step and no backend: plain HTML/CSS + vanilla
JS ES modules, rendered on a `<canvas>`.

- **`index.html`** — mounts each panel into a DOM container (header,
  scene info, adaptive grid, semantic legend, perception map, events,
  selected object, elevation, bottom metrics bar).
- **`src/app.js`** — `DashboardApp` orchestrator; runs a 60fps
  `requestAnimationFrame` loop that advances a "distance traveled"
  value and re-renders every panel each frame.
- **`src/lib/worldModel.js`** — procedural scene generator. Given a
  distance along a fixed 320m looped track, deterministically produces
  the ego pose, road curvature, static obstacles (poles/walls/humans),
  moving vehicles, a pothole, and live metrics. Four scenario zones
  (straight drive, pothole, left turn, dynamic interaction) come from
  this one function — there's no external data file or WebSocket.
- **`src/lib/colors.js`** — semantic color tokens (drivable, static
  wall/pole, dynamic vehicle/human, elevation gradient, etc.).
- **`src/components/*.js`** — one file per panel; each exports a
  `create<Panel>(container, ...)` that renders into its mount point and
  returns an `update(data)` method. `PerceptionMap.js` is the largest —
  the canvas renderer for the foveated grid, object markers/trails,
  compass and scale ruler.

There is currently no live backend integration (no `fetch`/WebSocket
calls anywhere) — everything is a deterministic function of elapsed
simulated distance, so the demo is fully self-contained and reproducible
for judging. Wiring in a real feed would mean adding a data source that
produces the same shape `worldModel.sampleAtDistance()` returns and
swapping the call site in `app.js`.

## Running locally

No install step — any static file server works:

```bash
cd dashboard
python -m http.server 8080
```

Then open `http://localhost:8080`. (Also wired up as the
`rakshasetu-dashboard` launch config.)

## Deploying

`netlify.toml` / `_redirects` are already set up for a static deploy
(Netlify or any static host that serves `dashboard/` as the site root).

## Note on prior work

An earlier FastAPI + React/Tailwind implementation of this dashboard
(with JWT auth, RBAC, a `/ws/live-feed` WebSocket contract, and an
ONNX/TensorRT optimization pass) lived here before this replacement.
That work is preserved in git history on this branch
(`feature/dashboard-redesign`, checkpoint commit `0408a99`) if any of
it — particularly the auth/security/optimization work — needs to be
revived or ported into this dashboard later.
