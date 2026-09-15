# RakshaSetu — Member 6 Vehicle Dashboard Handover
## Exact visual replication / implementation brief

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping  
**SIH:** PS26053  
**Target module:** Vehicle Perception Dashboard only  
**Primary reference:** the supplied dashboard screenshot and the four continuation frames in `reference_frames/`.

> **Critical instruction:** This work is a visual replication of the supplied vehicle dashboard. Do **not** redesign the layout, invent a new admin panel, change the visual language, or convert it into a different dashboard concept. The admin dashboard is a separate future module.

---

## 1. What is being handed over

The existing dashboard brief describes a real-time dashboard that renders the fused 2.5D map, semantic classes, tracked objects, and live metrics. It specifies a dark-mode visual language, six semantic classes, visibly different cell sizes, tracked-object overlays, a short motion trail, and live metrics from the WebSocket payload.

This handover narrows that work to the **vehicle perception dashboard shown in the provided reference image**.

The implementation must preserve the reference dashboard's:
- overall page composition
- dark blue/teal industrial UI
- cyan highlights
- green drivable region
- red static obstacles
- yellow/orange dynamic objects
- gray unknown/neutral regions
- thin technical borders and grid styling
- typography hierarchy
- panel positions
- map proportions
- metric-card placement
- vehicle/object icon treatment
- information density

Source dashboard brief: `05_dashboard_visualization.md` — mission is to show the live 2.5D map, semantic classes, tracked objects, and live metrics. fileciteturn5file0L8-L14

---

## 2. The four reference frames

Use these as **visual continuation states of the same dashboard**, not as four different UI designs.

### Frame 01 — Urban drive / straight
`reference_frames/01_urban_drive_straight.png`

Purpose:
- vehicle proceeding forward
- normal urban perception
- vehicle + pole + human detections
- large green drivable corridor
- red static boundaries
- adaptive cell size is visually obvious toward distance

### Frame 02 — Left turn
`reference_frames/02_left_turn.png`

Purpose:
- same exact dashboard shell
- vehicle is executing a left turn
- map geometry rotates/curves naturally
- tracked dynamic vehicle remains highlighted
- perception-event log updates

### Frame 03 — Pothole + curb
`reference_frames/03_pothole_detection.png`

Purpose:
- same exact dashboard shell
- pothole is detected as a terrain/elevation event
- curb is visible
- pothole size must correspond to the detected physical size
- selected-cell elevation information updates

### Frame 04 — Dynamic interaction during turn
`reference_frames/04_dynamic_turn.png`

Purpose:
- same exact dashboard shell
- dynamic vehicle/human interaction
- object track IDs and status change over time
- map follows vehicle movement
- event log updates without changing layout

---

## 3. Exact dashboard structure to implement

Keep this fixed.

### Header / top bar
Left:
- RS square mark
- RAKSHASETU
- subtitle: `ADAPTIVE 2.5D LIDAR PERCEPTION · SIH PS 26053 · DRDO`

Center:
- `LIVE PERCEPTION`

Right:
- `MODE SIMULATION (CARLA)`
- `SYSTEM ONLINE`
- digital time

### Left sidebar
1. **SCENE INFO**
   - Scenario
   - Time Elapsed
   - Vehicle Speed
   - Heading
   - Position (x, y)

2. **ADAPTIVE GRID (FOVEATED)**
   - Range
   - Cell Size
   - 0–10 m → 5 cm
   - 10–30 m → 15 cm
   - 30–60 m → 30 cm
   - 60–100/120 m → 50 cm

3. **SEMANTIC LEGEND**
   - Drivable (Road/Terrain)
   - Static Wall
   - Static Pole
   - Dynamic Vehicle
   - Dynamic Pedestrian / Human
   - Unclassified

Do not move these panels or merge them into another structure.

### Center
Main top-down LiDAR perception canvas.

This is the visual focus.

Required:
- ego vehicle at the bottom/near-center
- road/drivable area in green
- adaptive cells clearly visible
- cells become physically larger with distance
- static wall/pole layers in red
- dynamic vehicle in yellow
- human/pedestrian in orange/yellow
- unknown in gray
- labels attached to selected/important objects
- motion trail for moving objects
- road curves/turns should be represented naturally
- no rotating circular “radar disc” replacing the vehicle's forward-driving view

The source dashboard brief explicitly requires that resolution differences remain visible because this is part of the core demonstration. fileciteturn5file0L75-L79

### Right sidebar
1. **PERCEPTION EVENTS**
   - timestamp
   - event marker
   - event text
   - Static / Dynamic / update state

2. **SELECTED OBJECT**
   - Class
   - Track ID
   - Distance
   - Velocity
   - Confidence
   - Status
   - small object preview

3. **ELEVATION (2.5D)**
   - Selected Cell Height
   - Local Terrain Height
   - compact elevation gradient/scale

### Bottom bar
Stat tiles:
- FPS
- LATENCY
- mIoU
- GRID CELLS
- COMPUTE SAVINGS
- MEMORY USAGE

Right side:
- Pause
- Restart
- playback speed

The existing handover requires FPS, latency, mIoU, and compute savings to come from the live payload rather than being hardcoded. fileciteturn5file0L81-L82

---

## 4. Semantic colours

Keep the established semantic language.

- **Green:** drivable / road / terrain
- **Red:** static wall
- **Red / darker red:** static pole
- **Yellow:** dynamic vehicle
- **Orange:** human / pedestrian
- **Gray:** unclassified / unknown

The existing brief specifically calls for green for drivable, red shades for static classes, amber/orange shades for dynamic classes, and neutral gray for unknown. fileciteturn5file0L8-L10

Do not introduce unrelated color palettes.

---

## 5. Map behavior

The dashboard is a **vehicle perception view**, not an admin GIS view.

The vehicle should appear to move through the scene.

The scene should therefore support:
- straight driving
- left/right turns
- approaching static obstacles
- approaching dynamic vehicles
- human detection
- pothole/terrain anomalies
- changing tracked-object distances
- changing confidence
- changing event log
- changing elevation values
- visible adaptive cell-resolution transitions

### Important

Do **not** use a circular rotating radar/polar sweep as the primary vehicle visualization.

The map must read visually as:
**vehicle → forward road → perception field → detected objects/terrain**

The user is supposed to understand what the vehicle is seeing while driving.

---

## 6. Object naming

Use:

**Human**

in the visible UI.

Do not show `Pedestrian` as the primary label in the dashboard.

Internal data may still map from a backend semantic class called `dynamic_pedestrian`, but the UI text should display **Human**.

---

## 7. Pothole and terrain visualization

Potholes, curbs, poles and trees should use the same industrial/icon language as the vehicle perception dashboard.

Rules:
- small pothole → small visual marker
- large pothole → large visual marker
- selected anomaly → clear highlight
- terrain height change must affect the elevation panel
- do not make every pothole the same fixed size
- do not represent every terrain anomaly as a huge 3D model

This is a perception dashboard, so the visualization should remain compact and readable.

---

## 8. Data contract

The current dashboard brief describes one JSON/WebSocket frame containing:
- grid cells
- objects
- metrics

and uses `/ws/live-feed` for the live feed. fileciteturn5file0L41-L54

The current brief also notes that the mock format and later ROS2/interface format use different field names/shapes and should be reconciled when connecting to Member 4's real Fusion WebSocket output. fileciteturn5file0L56-L73

### Implementation rule

Build the renderer so a small adapter/normalizer converts the incoming payload into one internal UI format.

Do **not** rewrite the visual renderer every time the backend schema changes.

Suggested internal shape:

```js
{
  scene: {
    scenario,
    elapsed,
    speed_kmh,
    heading_deg,
    position: [x, y]
  },

  grid: [
    {
      range_bin,
      angular_bin,
      cell_size_m,
      class,
      height_mean,
      height_min,
      height_max,
      confidence
    }
  ],

  objects: [
    {
      track_id,
      class,
      ui_class,
      position: [x, y],
      velocity_mps,
      distance_m,
      confidence,
      is_dynamic,
      status,
      bbox,
      trail
    }
  ],

  elevation: {
    selected_cell_height_m,
    local_terrain_height_m
  },

  events: [],

  metrics: {
    fps,
    latency_ms,
    miou,
    grid_cells,
    compute_savings_pct,
    memory_mb
  }
}
```

---

## 9. Mock mode first

Do not block the UI on the real ML/ROS2 pipeline.

The existing brief explicitly recommends building the UI against a mock JSON feed first and only swapping to the live feed after the frontend is working. fileciteturn5file0L12-L14

Required demo states:
1. straight driving
2. left turn
3. pothole detection
4. dynamic vehicle interaction

Use deterministic scenario data so the same button produces the same visual behavior during judging.

---

## 10. Animation requirements

The four reference frames represent the visual progression.

The actual implementation should interpolate between states.

Examples:
- ego vehicle translates/steers smoothly
- grid geometry updates smoothly
- dynamic vehicle moves along its track
- human track moves slightly
- event entries appear as detections occur
- selected object values update
- FPS/latency/etc. update from data

Do not randomly teleport objects every frame.

---

## 11. Do NOT change these things

This section is mandatory.

**Do not:**
- replace the dashboard with a generic admin dashboard
- add tables/charts that are not visible in the reference
- redesign the sidebar
- change the top-bar structure
- use a completely different color palette
- convert the primary map into a 3D game scene
- add unnecessary 3D buildings
- add large decorative widgets
- replace the top-down perception map with a rotating radar
- remove the adaptive cell visualization
- remove the elevation panel
- remove the selected-object panel
- hide the metric tiles
- rename the product
- change the SIH/DRDO branding text
- invent additional navigation pages inside this module

Admin functionality will be implemented separately.

---

## 12. Code architecture

Keep rendering separate from data.

Recommended structure:

```text
dashboard/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── SceneInfo.jsx
│   │   │   ├── AdaptiveGridPanel.jsx
│   │   │   ├── SemanticLegend.jsx
│   │   │   ├── PerceptionMap.jsx
│   │   │   ├── EventsPanel.jsx
│   │   │   ├── SelectedObject.jsx
│   │   │   ├── ElevationPanel.jsx
│   │   │   └── MetricsBar.jsx
│   │   ├── lib/
│   │   │   ├── normalizeFrame.js
│   │   │   ├── colors.js
│   │   │   └── scenarios.js
│   │   └── App.jsx
│   └── ...
├── reference_frames/
│   ├── 01_urban_drive_straight.png
│   ├── 02_left_turn.png
│   ├── 03_pothole_detection.png
│   └── 04_dynamic_turn.png
└── HANDOVER_MEMBER_6_VEHICLE_DASHBOARD.md
```

This is a recommended implementation structure; match the repository's existing framework rather than duplicating the project.

---

## 13. Existing repository brief to preserve

The current dashboard documentation already specifies:
- FastAPI
- WebSocket `/ws/live-feed`
- React
- Three.js or deck.gl
- mock feed first
- visible adaptive resolution
- object overlays
- motion trails
- live performance metrics
- visual consistency with the pitch deck

These are existing project requirements and should remain compatible with the vehicle dashboard implementation. fileciteturn5file0L39-L56 fileciteturn5file0L75-L85

---

## 14. Acceptance criteria

The work is accepted only when all of the following are true:

- [ ] Dashboard visually matches the supplied reference screenshot.
- [ ] Four scenario states exist.
- [ ] All four states keep the same UI layout.
- [ ] Only scene/perception content changes between states.
- [ ] Vehicle is visibly driving through a forward scene.
- [ ] Left/right turn behavior is understandable.
- [ ] Adaptive cell sizes are visibly different by distance.
- [ ] Human is displayed as `Human`.
- [ ] Vehicles are slightly larger and easy to recognize.
- [ ] Ego vehicle is clearly visible.
- [ ] Static wall and pole are distinguishable.
- [ ] Pothole size follows detected size.
- [ ] Curbs/terrain anomalies are visible.
- [ ] Object IDs and confidence are shown.
- [ ] Motion trails are visible for dynamic objects.
- [ ] Elevation values update with terrain/cell selection.
- [ ] FPS, latency, mIoU, grid cells, compute savings and memory are live values.
- [ ] WebSocket reconnect/failure state is handled.
- [ ] No admin dashboard functionality is added to this module.
- [ ] No unnecessary layout or styling changes are introduced.

The source brief already warns that missing reconnect handling can silently freeze the map and that visible cell-size differences are a core requirement. fileciteturn5file0L100-L106

---

## 15. Final handover rule

**Treat the supplied screenshot as the visual source of truth.**

The four reference frames are not permission to redesign the application. They are continuity examples showing how the exact same vehicle dashboard should look as the driving/perception scene changes.

**Build the dashboard first.  
Keep the dashboard visually locked.  
Connect real data second.  
Build the separate admin dashboard later.**
