/**
 * RakshaSetu Road Network & Terrain Model
 *
 * A closed mountain-highway loop (4-lane divided carriageway, left-hand
 * traffic) threaded through a procedural heightfield. Everything here is
 * built once at module load and is deterministic, so every tab/replay sees
 * the same road, the same mountains and the same contour rings.
 *
 * Coordinate frame: x = east, y = north, z = up (metres).
 * Road frame:       s = arc length along the centreline,
 *                   d = lateral offset, positive to the RIGHT of travel.
 */

// ---------------------------------------------------------------------------
// Road cross-section (IRC 4-lane divided highway, simplified)
// ---------------------------------------------------------------------------
export const LANE_WIDTH = 3.5;
export const ROAD = {
  laneWidth: LANE_WIDTH,
  lanes: 4,
  medianHalf: 0.25,                // painted double-yellow median
  carriageHalf: 2 * LANE_WIDTH + 0.25,   // 7.25 m edge line
  shoulderHalf: 9.0,               // paved shoulder / gravel edge
  formationHalf: 10.5,             // guardrail / cut toe
  // Lane centres (left-hand traffic: our two lanes are left of the median)
  laneCenters: {
    egoSlow: -(0.25 + LANE_WIDTH * 1.5),   // -5.5
    egoFast: -(0.25 + LANE_WIDTH * 0.5),   // -2.0
    oncFast: +(0.25 + LANE_WIDTH * 0.5),   // +2.0
    oncSlow: +(0.25 + LANE_WIDTH * 1.5)    // +5.5
  }
};

// ---------------------------------------------------------------------------
// Centreline: closed centripetal Catmull-Rom through survey control points
// ---------------------------------------------------------------------------
const CONTROL_POINTS = [
  [0, 0], [4, 110], [-8, 205], [-52, 285], [-135, 322], [-215, 300],
  [-258, 232], [-238, 160], [-262, 82], [-330, 32], [-352, -60],
  [-300, -140], [-205, -168], [-118, -140], [-52, -88]
];

function catmullRom(p0, p1, p2, p3, t) {
  // Centripetal parameterisation avoids cusps/overshoot on tight bends.
  const alpha = 0.5;
  const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-4;
  const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function buildCenterline() {
  // 1. Dense polyline through the control points
  const dense = [];
  const n = CONTROL_POINTS.length;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL_POINTS[(i - 1 + n) % n];
    const p1 = CONTROL_POINTS[i];
    const p2 = CONTROL_POINTS[(i + 1) % n];
    const p3 = CONTROL_POINTS[(i + 2) % n];
    for (let k = 0; k < 200; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 200));
  }
  // 2. Cumulative arc length
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[cum.length - 1];
  // 3. Resample at exactly STEP metres (closed loop)
  const count = Math.round(length / 1.0);
  const step = length / count;
  const xs = new Float64Array(count), ys = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (cum[j + 1] < target) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const w = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[i] = a[0] + (b[0] - a[0]) * w;
    ys[i] = a[1] + (b[1] - a[1]) * w;
  }
  return { xs, ys, count, step, length };
}

const CL = buildCenterline();
export const TRACK_LENGTH = CL.length;
const N = CL.count;
const STEP = CL.step;

// Heading & curvature per sample (central differences on the closed loop)
const YAW = new Float64Array(N);
const CURV = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = (i - 1 + N) % N, b = (i + 1) % N;
  YAW[i] = Math.atan2(CL.ys[b] - CL.ys[a], CL.xs[b] - CL.xs[a]);
}
for (let i = 0; i < N; i++) {
  const a = (i - 2 + N) % N, b = (i + 2) % N;
  let dy = YAW[b] - YAW[a];
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  CURV[i] = dy / (4 * STEP);   // +ve = turning left
}

// ---------------------------------------------------------------------------
// Natural terrain: gaussian massifs + ridged fBm
// ---------------------------------------------------------------------------
const PEAKS = [
  // [cx, cy, amplitude, sigma]
  [-150, 95, 120, 62],     // inner massif (inside the loop)
  [-130, -50, 55, 38],
  [150, 170, 175, 95],     // east ridge
  [-10, 470, 150, 85],     // north
  [-460, 230, 185, 105],   // west
  [-470, -170, 130, 85],
  [-170, -360, 150, 95],   // south
  [170, -130, 115, 72],
  [120, 420, 110, 70]
];

function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function ridgedFbm(x, y) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 5; o++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function naturalHeight(x, y) {
  let h = 0;
  for (const [cx, cy, a, s] of PEAKS) {
    const dx = x - cx, dy = y - cy;
    h += a * Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
  }
  // Ridges scale with the massif so valley floors stay gentle
  h += ridgedFbm(x / 150 + 7.3, y / 150 - 2.1) * (18 + h * 0.35);
  return h;
}

// ---------------------------------------------------------------------------
// Road profile: smoothed natural ground along the centreline (valley road)
// ---------------------------------------------------------------------------
const ROAD_Z = new Float64Array(N);
(() => {
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) raw[i] = naturalHeight(CL.xs[i], CL.ys[i]) * 0.55;
  const W = 120;  // ±120 m moving average removes local humps
  let mean = 0;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -W; k <= W; k++) s += raw[(i + k + N) % N];
    ROAD_Z[i] = s / (2 * W + 1);
    mean += ROAD_Z[i] / N;
  }
  // Compress relief so the steepest pitch matches a hill-road ruling
  // gradient (IRC: ~6 %) instead of the raw valley profile.
  let maxGrade = 0;
  for (let i = 0; i < N; i++) {
    maxGrade = Math.max(maxGrade, Math.abs(ROAD_Z[(i + 1) % N] - ROAD_Z[i]) / STEP);
  }
  const k = maxGrade > 0.06 ? 0.06 / maxGrade : 1;
  for (let i = 0; i < N; i++) ROAD_Z[i] = mean + (ROAD_Z[i] - mean) * k;
})();

// ---------------------------------------------------------------------------
// Track sampling
// ---------------------------------------------------------------------------
export function wrapS(s) {
  return ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
}

/** Signed shortest along-track distance from sFrom to sTo. */
export function deltaS(sFrom, sTo) {
  let d = wrapS(sTo) - wrapS(sFrom);
  if (d > TRACK_LENGTH / 2) d -= TRACK_LENGTH;
  if (d < -TRACK_LENGTH / 2) d += TRACK_LENGTH;
  return d;
}

function lerpAngle(a, b, w) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * w;
}

export function sampleTrack(s) {
  const u = wrapS(s) / STEP;
  const i0 = Math.floor(u) % N, i1 = (i0 + 1) % N, w = u - Math.floor(u);
  return {
    x: CL.xs[i0] + (CL.xs[i1] - CL.xs[i0]) * w,
    y: CL.ys[i0] + (CL.ys[i1] - CL.ys[i0]) * w,
    z: ROAD_Z[i0] + (ROAD_Z[i1] - ROAD_Z[i0]) * w,
    yaw: lerpAngle(YAW[i0], YAW[i1], w),
    curvature: CURV[i0] + (CURV[i1] - CURV[i0]) * w,
    grade: (ROAD_Z[i1] - ROAD_Z[i0]) / STEP
  };
}

/** Road frame (s, d) -> world (x, y, z). Includes superelevation-free flat deck. */
export function roadToWorld(s, d, dz = 0) {
  const t = sampleTrack(s);
  // Right-hand normal of heading (cos, sin) is (sin, -cos)
  return {
    x: t.x + Math.sin(t.yaw) * d,
    y: t.y - Math.cos(t.yaw) * d,
    z: t.z + dz,
    yaw: t.yaw
  };
}

// ---------------------------------------------------------------------------
// Terrain grid (road-cut blended heightfield)
// ---------------------------------------------------------------------------
const TERRAIN_CELL = 5;
const MARGIN = 480;
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < N; i++) {
  minX = Math.min(minX, CL.xs[i]); maxX = Math.max(maxX, CL.xs[i]);
  minY = Math.min(minY, CL.ys[i]); maxY = Math.max(maxY, CL.ys[i]);
}
const GX0 = Math.floor((minX - MARGIN) / TERRAIN_CELL) * TERRAIN_CELL;
const GY0 = Math.floor((minY - MARGIN) / TERRAIN_CELL) * TERRAIN_CELL;
const GW = Math.ceil((maxX + MARGIN - GX0) / TERRAIN_CELL) + 1;
const GH = Math.ceil((maxY + MARGIN - GY0) / TERRAIN_CELL) + 1;

function nearestOnTrack(x, y, coarse) {
  // Coarse scan every 4 samples, then refine locally.
  let best = Infinity, bi = 0;
  for (let i = 0; i < N; i += coarse) {
    const dx = x - CL.xs[i], dy = y - CL.ys[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bi = i; }
  }
  for (let k = -coarse; k <= coarse; k++) {
    const i = (bi + k + N) % N;
    const dx = x - CL.xs[i], dy = y - CL.ys[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bi = i; }
  }
  return { i: bi, dist: Math.sqrt(best) };
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const HEIGHTS = new Float32Array(GW * GH);
const ROAD_DIST = new Float32Array(GW * GH);
(() => {
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = GX0 + gx * TERRAIN_CELL, y = GY0 + gy * TERRAIN_CELL;
      const nat = naturalHeight(x, y);
      const { i, dist } = nearestOnTrack(x, y, 4);
      // Road formation is flat out to the guardrail, then a cut/fill batter
      // blends into the natural slope over ~40 m.
      const w = smoothstep(ROAD.formationHalf + 1.5, ROAD.formationHalf + 42, dist);
      const idx = gy * GW + gx;
      HEIGHTS[idx] = ROAD_Z[i] - 0.35 + (nat - ROAD_Z[i] + 0.35) * w;
      ROAD_DIST[idx] = dist;
    }
  }
})();

export const TERRAIN = {
  cell: TERRAIN_CELL,
  x0: GX0,
  y0: GY0,
  width: GW,
  height: GH,
  heights: HEIGHTS,
  roadDist: ROAD_DIST
};

let hMin = Infinity, hMax = -Infinity;
for (let i = 0; i < HEIGHTS.length; i++) {
  if (HEIGHTS[i] < hMin) hMin = HEIGHTS[i];
  if (HEIGHTS[i] > hMax) hMax = HEIGHTS[i];
}
TERRAIN.minZ = hMin;
TERRAIN.maxZ = hMax;

/** Bilinear terrain height at world (x, y). */
export function terrainHeight(x, y) {
  const fx = (x - GX0) / TERRAIN_CELL, fy = (y - GY0) / TERRAIN_CELL;
  const ix = Math.max(0, Math.min(GW - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(GH - 2, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - ix)), v = Math.min(1, Math.max(0, fy - iy));
  const h00 = HEIGHTS[iy * GW + ix], h10 = HEIGHTS[iy * GW + ix + 1];
  const h01 = HEIGHTS[(iy + 1) * GW + ix], h11 = HEIGHTS[(iy + 1) * GW + ix + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

/** Distance from a world point to the road centreline (grid-interpolated). */
export function roadDistance(x, y) {
  const fx = Math.round((x - GX0) / TERRAIN_CELL), fy = Math.round((y - GY0) / TERRAIN_CELL);
  if (fx < 0 || fy < 0 || fx >= GW || fy >= GH) return Infinity;
  return ROAD_DIST[fy * GW + fx];
}

export const CENTERLINE = { xs: CL.xs, ys: CL.ys, zs: ROAD_Z, yaw: YAW, curvature: CURV, count: N, step: STEP };

/** Altitude datum so the readout looks like a Himalayan pass road (MSL). */
export const ALTITUDE_DATUM_M = 3450;

export { hash2 };
