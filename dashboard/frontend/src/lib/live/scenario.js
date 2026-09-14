// Deterministic "URBAN TURN" demo scenario: the ego vehicle's own scripted
// pose (position + heading + speed) as it drives a straight road, slows for
// an intersection, takes a right turn, and continues on the new street.
//
// This is presentation-layer staging only -- the actual PERCEPTION data
// (grid cells, tracked objects, metrics) still comes entirely from
// useLiveFeed/the real backend feed, unchanged. This module never invents a
// detection; it only tells the scene where the camera/vehicle is standing
// and rotates real ego-relative data to match, plus draws the road/building
// backdrop the vehicle appears to be driving through. Swapping the mock
// feed for ROS2/CARLA/real LiDAR later touches none of this file.
//
// Track-space convention: heading 0deg = the +y axis ("forward" at the
// start of the loop), positive heading = clockwise (matches the rest of
// the app's ego-relative angle convention), so sin/cos below mirror
// coordinateTransform.js's rotateByHeading.

export const CYCLE_S = 60;
export const SCENARIO_LABEL = "Urban Turn — Dynamic Obstacle";

// [timeS, value] keyframes, linearly interpolated between neighbors.
const SPEED_KMH_KEYFRAMES = [
  [0, 16], [8, 16], [14, 8], [18, 4], [23, 9], [35, 18], [45, 18], [55, 16], [60, 16],
];
const HEADING_DEG_KEYFRAMES = [
  [0, 0], [18, 0], [23, 90], [60, 90],
];

const PHASE_BOUNDARIES = [
  [8, "straight"],
  [14, "approaching intersection"],
  [18, "slowing"],
  [23, "turning right"],
  [35, "new road"],
  [45, "dynamic zone"],
  [60, "continuing"],
];

function lerpKeyframes(keyframes, t) {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, v0] = keyframes[i];
    const [t1, v1] = keyframes[i + 1];
    if (t >= t0 && t <= t1) {
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * k;
    }
  }
  return keyframes[keyframes.length - 1][1];
}

function phaseForTime(t) {
  for (const [end, label] of PHASE_BOUNDARIES) {
    if (t < end) return label;
  }
  return PHASE_BOUNDARIES[PHASE_BOUNDARIES.length - 1][1];
}

// Precompute a position table once by integrating speed along heading --
// cheap (1200 samples), avoids re-integrating from t=0 on every render.
const SAMPLE_DT_S = 0.05;
const POSITION_TABLE = (function build() {
  const table = [{ t: 0, x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (let t = SAMPLE_DT_S; t <= CYCLE_S + SAMPLE_DT_S / 2; t += SAMPLE_DT_S) {
    const speedMps = lerpKeyframes(SPEED_KMH_KEYFRAMES, t) / 3.6;
    const rad = (lerpKeyframes(HEADING_DEG_KEYFRAMES, t) * Math.PI) / 180;
    x += speedMps * Math.sin(rad) * SAMPLE_DT_S;
    y += speedMps * Math.cos(rad) * SAMPLE_DT_S;
    table.push({ t, x, y });
  }
  return table;
})();

function samplePosition(t) {
  const idx = Math.min(POSITION_TABLE.length - 2, Math.max(0, Math.floor(t / SAMPLE_DT_S)));
  const a = POSITION_TABLE[idx];
  const b = POSITION_TABLE[idx + 1];
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

const LOOP_FADE_WINDOW_S = 1.2;

/** The ego vehicle's scripted pose at a given elapsed time (ms since demo
 * start, already speed/pause-adjusted by the caller). Loops seamlessly by
 * fading the scene near the wrap boundary rather than jumping. */
export function getEgoPose(elapsedMs) {
  const t = (((elapsedMs / 1000) % CYCLE_S) + CYCLE_S) % CYCLE_S;
  const speedKmh = lerpKeyframes(SPEED_KMH_KEYFRAMES, t);
  const headingDeg = lerpKeyframes(HEADING_DEG_KEYFRAMES, t);
  const { x, y } = samplePosition(t);
  const phase = phaseForTime(t);

  let fade = 1;
  if (t < LOOP_FADE_WINDOW_S) fade = 0.12 + 0.88 * (t / LOOP_FADE_WINDOW_S);
  else if (t > CYCLE_S - LOOP_FADE_WINDOW_S) fade = 0.12 + 0.88 * ((CYCLE_S - t) / LOOP_FADE_WINDOW_S);

  return { x, y, headingDeg, speedKmh, phase, fade, t };
}

// The road backdrop, authored in the same absolute track-space the pose
// above lives in: two straight segments joined by the turn, plus a couple
// of building silhouettes to read as "a street", not empty void. Purely
// atmospheric background -- nothing here is a labeled detection; every
// tagged/tracked object in the scene comes from the real feed.
export const ROAD_WIDTH_M = 9;
export const ROAD_SEGMENTS = [
  { from: { x: 0, y: -20 }, to: { x: 0, y: 66 } }, // first straight, heading 0
  { from: { x: 0, y: 66 }, to: { x: 90, y: 72 } }, // the turn + new street, heading ~90
];
export const BUILDING_BLOCKS = [
  { x: -22, y: 20, w: 16, h: 46, side: "left1" },
  { x: 14, y: 15, w: 14, h: 40, side: "right1" },
  { x: 30, y: 62, w: 40, h: 18, side: "far-left2" },
  { x: 30, y: 84, w: 46, h: 18, side: "far-right2" },
];
