// Roadside scene dressing (trees/poles/walls/curbs/potholes) shown on the
// Top-Down LiDAR sweep and Vehicle HUD. The real data contract only carries
// {drivable, wall, pole, vehicle, pedestrian, unknown} per grid cell/object
// (see lib/colors.js's CLASS) -- it has no distinct "tree" or "curb" or
// "pothole" class, so these props are deliberately decorative scenery, the
// same kind of non-data flavor components/live/RoadEnvironment.jsx already
// adds elsewhere in this app. A fixed seed keeps the same layout across
// reloads instead of reshuffling the scene on every mount.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROP_TYPES = ["tree", "pole", "wall", "curb", "pothole"];
const SEED = 26053; // SIH PS 26053 -- arbitrary but fixed
const COUNT = 14;

function generate() {
  const rand = mulberry32(SEED);
  const props = [];
  for (let i = 0; i < COUNT; i++) {
    const type = PROP_TYPES[Math.floor(rand() * PROP_TYPES.length)];
    const rangeM = 6 + rand() * 42;
    const bearingDeg = rand() * 360;
    // Pothole/curb severity genuinely varies the rendered icon size --
    // small potholes should look small, big ones should look big.
    const sizeScale = type === "pothole" || type === "curb" ? 0.6 + rand() * 1.1 : 1;
    props.push({ id: `prop-${i}`, type, rangeM, bearingDeg, sizeScale });
  }
  return props;
}

export const ROADSIDE_PROPS = generate();

/** Props within a forward field of view (heading measured the same way as
 * PolarGrid/WindshieldView: 0 = straight ahead, +/- clockwise/counter). */
export function forwardProps(fovDeg, maxRangeM) {
  return ROADSIDE_PROPS.filter((p) => {
    const bearing = ((p.bearingDeg + 180) % 360) - 180;
    return Math.abs(bearing) <= fovDeg / 2 && p.rangeM <= maxRangeM;
  });
}
