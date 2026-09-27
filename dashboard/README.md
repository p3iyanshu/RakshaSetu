# RakshaSetu Dashboard

Vehicle perception dashboard for the adaptive variable-resolution 2.5D
LiDAR pipeline (SIH PS 26053) — the top-down "vehicle is driving and
sees the world" view from `HANDOVER_MEMBER_6_VEHICLE_DASHBOARD.md`.

Originally built at
[github.com/Xxnil-nxX/rsdashboard](https://github.com/Xxnil-nxX/rsdashboard)
and adopted here as the project's dashboard.

## Architecture

Static site, no build step and no backend: plain HTML/CSS + vanilla
JS ES modules. The centre view is a WebGL2 2.5D scene with a 2D canvas
and HTML overlay on top.

- **`index.html`** — mounts each panel into a DOM container (header,
  scene info, adaptive grid, semantic legend, perception map, events,
  selected object, elevation, bottom metrics bar).
- **`src/app.js`** — `DashboardApp` orchestrator; runs a
  `requestAnimationFrame` loop that advances the ego along the track at
  the speed-profile speed and re-renders every panel each frame.
- **`src/lib/roadNetwork.js`** — the world geometry, built once at load:
  a closed ~1.4 km mountain-highway loop (centripetal Catmull-Rom
  centreline, 4-lane divided carriageway, left-hand traffic, ≤ 6 %
  grade, 33 m hairpin) and a procedural heightfield (gaussian massifs +
  ridged fBm) blended into a flat road formation with cut/fill batters.
- **`src/lib/worldModel.js`** — deterministic scenario engine: given the
  distance travelled it returns the ego pose, a curvature-limited speed,
  lane changes (overtaking slow traffic, avoiding Pothole #21), tracked
  objects with world + ego-frame positions, the planned path and
  metrics. Four zones: Highway Cruise, Pothole Detection, Hairpin Turn,
  Oncoming Traffic.
- **`src/render/`** — WebGL2 renderer. `shaders.js` draws terrain with
  hypsometric tint, hillshade and concentric contour lines (5 m minor /
  25 m index), foveated range rings (10/30/60/120 m), LiDAR point
  returns and sweep; the road shader paints IRC lane markings, the
  foveated drivable grid and pothole decals. `sceneRenderer.js` builds
  the meshes, instanced scenery (forest, rocks, guardrails, milestones)
  and extruded 3D objects, and owns the 2.5D / TOP / CHASE camera.
- **`src/components/PerceptionMap.js`** — hosts the scene plus the
  overlay (planned trajectory, velocity vectors, 3D selection box,
  decluttered callouts), road/terrain HUD, route minimap and view
  controls (drag to orbit, wheel to zoom, double-click to reset).
- **`src/components/*.js`** — one file per side panel; each exports a
  `create<Panel>(container, ...)` that returns an `update(data)` method.

There is currently no live backend integration (no `fetch`/WebSocket
calls anywhere) — everything is a deterministic function of elapsed
simulated distance, so the demo is fully self-contained and reproducible
for judging. Wiring in a real feed would mean adding a data source that
produces the same shape `WORLD_MODEL.sampleAtDistance()` returns and
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
