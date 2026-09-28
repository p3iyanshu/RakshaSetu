/**
 * World Model & LiDAR Perception Dynamics for RakshaSetu
 * SIH PS 26053 · DRDO
 *
 * Deterministic scenario engine on the mountain-highway loop defined in
 * roadNetwork.js. Every frame is a pure function of the ego's distance
 * travelled `s`, so jumps, replays and the admin console stay in sync.
 *
 * - Ego follows a curvature-limited speed profile (slows for the hairpin).
 * - Other traffic follows the same profile scaled by a per-vehicle factor,
 *   using the lap time table, so relative motion stays physically plausible.
 * - Ego lane choice (slow lane <-> overtaking lane) is re-derived from the
 *   scene over a trailing window, which gives smooth, repeatable lane changes.
 * - Humans, poles, walls, trees and potholes are strictly static (0.0 m/s).
 */

import { CONFIG } from './config.js';
import {
  ROAD, TRACK_LENGTH, sampleTrack, roadToWorld, wrapS, deltaS,
  terrainHeight, ALTITUDE_DATUM_M
} from './roadNetwork.js';

// A retired track must never re-enter a frame, even if a future scenario
// fixture accidentally adds it back to one of the object collections.
export const RETIRED_TRACK_IDS = new Set(['27']);

export function isRetiredObject(object) {
  return RETIRED_TRACK_IDS.has(String(object?.track_id ?? object?.id ?? ''));
}

const LANE = ROAD.laneCenters;

// Pipeline class ids (shared/schemas.py). The dashboard's finer UI classes
// map onto the six segmentation classes the real pipeline emits.
export const CLASS_IDS = {
  pothole: 0,            // DRIVABLE surface with a negative height
  static_wall: 1,        // STATIC_OBSTACLE_WALL
  curb: 1,
  static_pole: 2,        // STATIC_OBSTACLE_POLE
  static_tree: 2,
  dynamic_vehicle: 3,    // DYNAMIC_VEHICLE
  dynamic_human: 4,      // DYNAMIC_PEDESTRIAN
  unclassified: 5        // OTHER_UNKNOWN
};

// Scenario zones along the loop (start s, name). Speeds come from CONFIG.
export const SCENARIOS = [
  { name: 'Highway Cruise', start: 0 },
  { name: 'Pothole Detection', start: 170 },
  { name: 'Hairpin Turn', start: 470 },
  { name: 'Oncoming Traffic', start: 850 }
];

function scenarioAt(loopS) {
  let current = SCENARIOS[0];
  for (const sc of SCENARIOS) if (loopS >= sc.start) current = sc;
  return current;
}

const BBOX = {
  car: { l: 4.4, w: 1.85, h: 1.5 },
  suv: { l: 4.8, w: 1.95, h: 1.8 },
  truck: { l: 9.5, w: 2.5, h: 3.3 },
  human: { l: 0.5, w: 0.5, h: 1.75 },
  pole: { l: 0.3, w: 0.3, h: 7.5 },
  tree: { l: 4.5, w: 4.5, h: 9.0 },
  wall: { l: 16.0, w: 0.6, h: 2.4 },
  boulder: { l: 1.6, w: 1.4, h: 1.1 },
  curb: { l: 2.0, w: 0.3, h: 0.2 }
};

export class WorldModel {
  constructor() {
    this.totalLength = TRACK_LENGTH;
    this.scenarios = SCENARIOS;

    // Static infrastructure & static pedestrians (road frame: s, d)
    this.staticObjects = [
      // Highway cruise
      { track_id: '11', name: 'POLE #11', class: 'static_pole', ui_class: 'Static Pole', s: 62, d: -9.6, confidence: 0.95, bbox: BBOX.pole },
      { track_id: '12', name: 'HUMAN #12', class: 'dynamic_human', ui_class: 'Dynamic Human', s: 96, d: -9.8, confidence: 0.91, bbox: BBOX.human },
      { track_id: '09', name: 'POLE #09', class: 'static_pole', ui_class: 'Static Pole', s: 118, d: 9.6, confidence: 0.94, bbox: BBOX.pole },
      { track_id: 'wall_1', name: 'WALL', class: 'static_wall', ui_class: 'Retaining Wall', s: 140, d: -11.2, confidence: 0.98, bbox: BBOX.wall },
      { track_id: '13', name: 'TREE #13', class: 'static_tree', ui_class: 'Static Tree', s: 80, d: 14.5, confidence: 0.92, bbox: BBOX.tree },

      // Pothole section
      { track_id: '14', name: 'POLE #14', class: 'static_pole', ui_class: 'Static Pole', s: 232, d: -9.6, confidence: 0.96, bbox: BBOX.pole },
      { track_id: '19', name: 'HUMAN #19', class: 'dynamic_human', ui_class: 'Dynamic Human', s: 268, d: 9.9, confidence: 0.89, bbox: BBOX.human },
      { track_id: '21', name: 'POTHOLE #21', class: 'pothole', ui_class: 'Static Obstacle', s: 312, d: -5.3, radius: 1.3, confidence: 0.93, bbox: { l: 2.6, w: 1.8, h: 0.22 } },
      { track_id: '17', name: 'POLE #17', class: 'static_pole', ui_class: 'Static Pole', s: 336, d: 9.6, confidence: 0.95, bbox: BBOX.pole },
      { track_id: 'curb', name: 'CURB', class: 'curb', ui_class: 'Curb', s: 356, d: -9.1, confidence: 0.96, bbox: BBOX.curb },
      { track_id: '20', name: 'TREE #20', class: 'static_tree', ui_class: 'Static Tree', s: 290, d: -14.0, confidence: 0.9, bbox: BBOX.tree },

      // Hairpin
      { track_id: '22', name: 'POLE #22', class: 'static_pole', ui_class: 'Static Pole', s: 520, d: 9.6, confidence: 0.95, bbox: BBOX.pole },
      { track_id: '23', name: 'HUMAN #23', class: 'dynamic_human', ui_class: 'Dynamic Human', s: 612, d: -9.7, confidence: 0.85, bbox: BBOX.human },
      { track_id: 'wall_turn', name: 'WALL', class: 'static_wall', ui_class: 'Retaining Wall', s: 575, d: -11.2, confidence: 0.98, bbox: BBOX.wall },
      { track_id: '24', name: 'ROCK #24', class: 'unclassified', ui_class: 'Rockfall Debris', s: 700, d: 8.4, confidence: 0.78, bbox: BBOX.boulder },

      // Oncoming traffic
      { track_id: '28', name: 'POLE #28', class: 'static_pole', ui_class: 'Static Pole', s: 930, d: -9.6, confidence: 0.94, bbox: BBOX.pole },
      // Small stationary object on the shoulder the segmenter can't place in any
      // class (OTHER_UNKNOWN, low confidence) -> drives the inspection alert
      { track_id: '41', name: 'OBJECT #41', class: 'unclassified', ui_class: 'Unidentified Object', shape: 'box', s: 985, d: -8.9, confidence: 0.41, bbox: { l: 0.7, w: 0.5, h: 0.45 } },
      { track_id: '29', name: 'HUMAN #29', class: 'dynamic_human', ui_class: 'Dynamic Human', s: 1040, d: 9.8, confidence: 0.87, bbox: BBOX.human },
      { track_id: '30', name: 'TREE #30', class: 'static_tree', ui_class: 'Static Tree', s: 1150, d: -14.5, confidence: 0.9, bbox: BBOX.tree },
      { track_id: 'wall_3', name: 'WALL', class: 'static_wall', ui_class: 'Retaining Wall', s: 1250, d: 11.2, confidence: 0.97, bbox: BBOX.wall }
    ].filter((object) => !isRetiredObject(object));

    // Dynamic traffic (ONLY VEHICLES MOVE).
    // k   = fraction of the ego speed profile the vehicle drives at
    // dir = +1 with ego, -1 oncoming (uses the opposite carriageway)
    this.dynamicVehicles = [
      { track_id: '04', name: 'VEHICLE #04', kind: 'car', lane: LANE.egoSlow, dir: 1, k: 0.6, s0: 38, confidence: 0.93, color: 'amber' },
      { track_id: '18', name: 'VEHICLE #18', kind: 'truck', lane: LANE.egoSlow, dir: 1, k: 0.6, s0: 305, confidence: 0.88, color: 'olive' },
      { track_id: '31', name: 'VEHICLE #31', kind: 'suv', lane: LANE.egoSlow, dir: 1, k: 0.6, s0: 455, confidence: 0.9, color: 'slate' },
      { track_id: '26', name: 'VEHICLE #26', kind: 'car', lane: LANE.oncFast, dir: -1, k: 1.0, s0: 260, confidence: 0.92, color: 'white' },
      { track_id: '33', name: 'VEHICLE #33', kind: 'truck', lane: LANE.oncSlow, dir: -1, k: 0.7, s0: 900, confidence: 0.9, color: 'red' },
      { track_id: '35', name: 'VEHICLE #35', kind: 'suv', lane: LANE.oncFast, dir: -1, k: 1.0, s0: 1300, confidence: 0.91, color: 'white' },
      { track_id: '37', name: 'VEHICLE #37', kind: 'car', lane: LANE.oncFast, dir: -1, k: 1.0, s0: 760, confidence: 0.9, color: 'amber' }
    ];

    this.buildSpeedProfile();
  }

  // -------------------------------------------------------------------------
  // Speed profile & lap-time table
  // -------------------------------------------------------------------------
  buildSpeedProfile() {
    const L = this.totalLength;
    const n = Math.ceil(L);
    const aLat = 1.2; // comfortable lateral acceleration for a heavy UGV (m/s^2)
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = sampleTrack(i);
      const capKmh = CONFIG.scenarioSpeedsKmh[scenarioAt(i).name] ?? 32;
      const vCurve = Math.sqrt(aLat / Math.max(1e-4, Math.abs(t.curvature)));
      raw[i] = Math.min(capKmh / 3.6, vCurve);
    }
    // Look-ahead braking: v(s) <= v(s+x) + decel margin, then smooth
    const v = new Float64Array(raw);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = v[(i + 1) % n];
        v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * 0.9 * 1));
      }
    }
    const smooth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -12; k <= 12; k++) acc += v[(i + k + n) % n];
      smooth[i] = Math.max(4.5, acc / 25);
    }
    this.speedTable = smooth;
    // Cumulative time table over one lap
    this.timeTable = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.timeTable[i + 1] = this.timeTable[i] + 1 / smooth[i];
    this.lapTime = this.timeTable[n];
    this.profileKey = JSON.stringify(CONFIG.scenarioSpeedsKmh);
  }

  speedAt(s) {
    const n = this.speedTable.length;
    const u = wrapS(s), i = Math.floor(u) % n, w = u - Math.floor(u);
    return this.speedTable[i] * (1 - w) + this.speedTable[(i + 1) % n] * w;
  }

  /** Elapsed time (s) to reach unbounded distance s. */
  timeAt(s) {
    const L = this.totalLength;
    const laps = Math.floor(s / L);
    const u = s - laps * L;
    const i = Math.floor(u), w = u - i;
    const n = this.timeTable.length - 1;
    const t0 = this.timeTable[Math.min(i, n)], t1 = this.timeTable[Math.min(i + 1, n)];
    return laps * this.lapTime + t0 + (t1 - t0) * w;
  }

  /** Inverse of timeAt: unbounded distance reached after time t. */
  distanceAt(t) {
    const laps = Math.floor(t / this.lapTime);
    const r = t - laps * this.lapTime;
    const tt = this.timeTable;
    let lo = 0, hi = tt.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tt[mid] <= r) lo = mid; else hi = mid;
    }
    const w = (r - tt[lo]) / ((tt[hi] - tt[lo]) || 1);
    return laps * this.totalLength + Math.min(lo + w, this.totalLength);
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------
  vehicleStateAt(veh, t) {
    if (veh.dir > 0) {
      // Drives the ego speed profile scaled by k
      const s = this.distanceAt(this.timeAt(veh.s0) + veh.k * t);
      return { s: wrapS(s), speed: veh.k * this.speedAt(s) };
    }
    const speed = 9.0 * veh.k;
    return { s: wrapS(veh.s0 - speed * t), speed };
  }

  /** Discrete lane the ego planner wants at distance s (before smoothing). */
  laneTargetAt(s) {
    const t = this.timeAt(s);
    for (const veh of this.dynamicVehicles) {
      if (veh.dir < 0 || veh.lane !== LANE.egoSlow) continue;
      const gap = deltaS(s, this.vehicleStateAt(veh, t).s);
      const half = veh.kind === 'truck' ? 7 : 4;
      if (gap > -(8 + half) && gap < 44 + half) return LANE.egoFast;
    }
    for (const obj of this.staticObjects) {
      if (obj.class !== 'pothole' || obj.d > -3.5) continue;
      const gap = deltaS(s, obj.s);
      if (gap > -4 && gap < 48) return LANE.egoFast;
    }
    return LANE.egoSlow;
  }

  /** Smoothed ego lateral offset: cosine-weighted trailing window. */
  egoLateralAt(s) {
    const WINDOW = 26, STEPS = 14;
    let acc = 0, wsum = 0;
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      const w = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (f * 0.5 + 0.25)) + 0.15;
      acc += this.laneTargetAt(s - f * WINDOW) * w;
      wsum += w;
    }
    return acc / wsum;
  }

  // -------------------------------------------------------------------------
  // Frame sampling
  // -------------------------------------------------------------------------
  sampleAtDistance(s) {
    if (this.profileKey !== JSON.stringify(CONFIG.scenarioSpeedsKmh)) this.buildSpeedProfile();

    const loopS = wrapS(s);
    const road = sampleTrack(loopS);
    const scenario = scenarioAt(loopS).name;
    const t = this.timeAt(s);
    const speedMps = this.speedAt(s);

    // Ego pose
    const lat = this.egoLateralAt(s);
    const latAhead = this.egoLateralAt(s + 2.0);
    const steerRad = Math.atan2(latAhead - lat, 2.0);
    const egoP = roadToWorld(loopS, lat, 0);
    const egoYaw = road.yaw - steerRad;   // +d is to the right -> clockwise
    const ego = { x: egoP.x, y: egoP.y, z: egoP.z, yaw: egoYaw, s: loopS, d: lat };

    const cosY = Math.cos(egoYaw), sinY = Math.sin(egoYaw);
    const toEgo = (wx, wy) => {
      const dx = wx - ego.x, dy = wy - ego.y;
      // [right, forward]
      return [dx * sinY - dy * cosY, dx * cosY + dy * sinY];
    };

    const visibleObjects = [];
    const inView = (ds) => ds > -35 && ds < 125;

    // Static objects (0.0 m/s)
    for (const obj of this.staticObjects) {
      if (isRetiredObject(obj)) continue;
      const ds = deltaS(loopS, obj.s);
      if (!inView(ds)) continue;
      const w = roadToWorld(obj.s, obj.d, 0);
      // Off-road objects sit on the terrain, not the road deck
      const onRoad = Math.abs(obj.d) <= ROAD.formationHalf;
      const z = onRoad ? w.z : terrainHeight(w.x, w.y);
      const [rx, fy] = toEgo(w.x, w.y);
      const dist = Math.hypot(rx, fy);
      visibleObjects.push({
        track_id: obj.track_id,
        name: obj.name,
        class: obj.class,
        cls: CLASS_IDS[obj.class] ?? 5,
        ui_class: obj.ui_class,
        shape: obj.shape,
        position: [Number(rx.toFixed(2)), Number(fy.toFixed(2))],
        world: { x: w.x, y: w.y, z, yaw: w.yaw },
        road: { s: obj.s, d: obj.d },
        velocity_mps: 0.0,
        distance_m: Number(dist.toFixed(1)),
        confidence: Math.round(obj.confidence * 100),
        is_dynamic: false,
        status: 'Stationary',
        radius: obj.radius || 1.0,
        bbox: obj.bbox
      });
    }

    // Dynamic vehicles
    for (const veh of this.dynamicVehicles) {
      if (isRetiredObject(veh)) continue;
      const st = this.vehicleStateAt(veh, t);
      const ds = deltaS(loopS, st.s);
      if (!inView(ds)) continue;
      const w = roadToWorld(st.s, veh.lane, 0);
      const yaw = veh.dir > 0 ? w.yaw : w.yaw + Math.PI;
      const [rx, fy] = toEgo(w.x, w.y);
      const bbox = BBOX[veh.kind] || BBOX.car;
      visibleObjects.push({
        track_id: veh.track_id,
        name: veh.name,
        class: 'dynamic_vehicle',
        cls: CLASS_IDS.dynamic_vehicle,
        ui_class: veh.kind === 'truck' ? 'Dynamic Vehicle (Truck)' : 'Dynamic Vehicle',
        kind: veh.kind,
        color: veh.color,
        direction: veh.dir > 0 ? 'Same direction' : 'Oncoming',
        position: [Number(rx.toFixed(2)), Number(fy.toFixed(2))],
        world: { x: w.x, y: w.y, z: w.z, yaw },
        road: { s: st.s, d: veh.lane },
        heading_sign: veh.dir,
        velocity_mps: Number(st.speed.toFixed(1)),
        distance_m: Number(Math.hypot(rx, fy).toFixed(1)),
        confidence: Math.round(veh.confidence * 100),
        is_dynamic: true,
        status: 'Moving',
        bbox
      });
    }

    const objects = visibleObjects
      .filter((object) => !isRetiredObject(object))
      .sort((a, b) => a.distance_m - b.distance_m);

    // Elevation telemetry
    // Planned ego trajectory (next 60 m) for the HUD path ribbon
    const plannedPath = [];
    for (let k = 0; k <= 60; k += 3) {
      const p = roadToWorld(loopS + k, this.egoLateralAt(s + k), 0.08);
      plannedPath.push([p.x, p.y, p.z]);
    }

    const nearPothole = objects.some(o => o.class === 'pothole' && o.distance_m < 16);
    const terrHeight = nearPothole ? -0.18 : Number((road.grade * 0.5).toFixed(2));

    const m = Math.floor(t / 60);
    const sec = (t % 60).toFixed(1);
    const bearing = ((90 - egoYaw * 180 / Math.PI) % 360 + 360) % 360;
    const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    return {
      distanceTraveled: loopS,
      lateralOffset: lat,
      steeringYawDeg: -steerRad * 180 / Math.PI,
      ego,
      plannedPath,
      road: {
        curvature: road.curvature,
        grade_pct: Number((road.grade * 100).toFixed(1)),
        radius_m: Math.abs(road.curvature) > 1e-4 ? Math.round(1 / Math.abs(road.curvature)) : Infinity,
        turn: road.curvature > 0.004 ? 'Left' : (road.curvature < -0.004 ? 'Right' : 'Straight'),
        lane: lat < (LANE.egoSlow + LANE.egoFast) / 2 ? 'Lane 1 (slow)' : 'Lane 2 (overtaking)'
      },
      scene: {
        scenario,
        elapsed: `${String(m).padStart(2, '0')}:${sec.padStart(4, '0')}`,
        speed_kmh: Number((speedMps * 3.6).toFixed(1)),
        speed_mps: speedMps,
        heading_deg: Number(bearing.toFixed(1)),
        heading_cardinal: CARD[Math.round(bearing / 45) % 8],
        position: [Number(ego.x.toFixed(1)), Number(ego.y.toFixed(1))],
        altitude_m: Math.round(ALTITUDE_DATUM_M + ego.z),
        grade_pct: Number((road.grade * 100).toFixed(1)),
        system_time: formatClock(17 * 3600 + 54 * 60 + 12 + Math.floor(t)),
        mode: 'SIMULATION (CARLA)',
        status: 'ONLINE'
      },
      // Final defensive gate: no source path may emit the retired Tree #27.
      objects,
      elevation: {
        selected_cell_height_m: nearPothole ? -0.22 : 0.12,
        local_terrain_height_m: terrHeight
      },
      metrics: {
        fps: Math.round(CONFIG.metricsBaseline.fps + Math.sin(t) * 2),
        latency_ms: Math.round(CONFIG.metricsBaseline.latency_ms + Math.cos(t) * 3),
        miou: Number((CONFIG.metricsBaseline.miou + Math.sin(t * 0.4) * 1.5).toFixed(1)),
        grid_cells: Math.floor(CONFIG.metricsBaseline.grid_cells + Math.sin(t * 0.8) * 600),
        compute_savings_pct: Number((CONFIG.metricsBaseline.compute_savings_pct + Math.cos(t * 0.5) * 1.2).toFixed(1)),
        memory_mb: CONFIG.metricsBaseline.memory_mb
      }
    };
  }
}

function formatClock(totalSec) {
  const h = Math.floor(totalSec / 3600) % 24;
  const mm = Math.floor(totalSec / 60) % 60;
  const ss = Math.floor(totalSec) % 60;
  return [h, mm, ss].map(v => String(v).padStart(2, '0')).join(':');
}

export const WORLD_MODEL = new WorldModel();
