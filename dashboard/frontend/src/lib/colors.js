// Class colors follow the dataviz skill's fixed status palette (good /
// warning / critical) rather than the generic categorical ramp, since these
// classes ARE a status signal (safe / caution / danger), not interchangeable
// series identity. Palette matches the RakshaSetu Console reference design
// (signal cyan for UI chrome, amber/safe/danger for data).
//
// v2 (2026-09-12): the old 3-class scheme (drivable/static_obstacle/
// dynamic_object) split into 6, per Member 4's ros2_ws/interfaces.md v2 SS4
// -- static into wall/pole, dynamic into vehicle/pedestrian, plus a new
// "other/unknown" class. Kept within the same 3 status families (safe /
// danger / caution) with a shade shift to distinguish the two members of
// each family, and added a neutral gray for "other/unknown" since that
// class is deliberately NOT a safe/caution/danger signal -- it means "a
// real object, but the model doesn't know which of the above it is".
export const CLASS = {
  DRIVABLE: 0,
  STATIC_OBSTACLE_WALL: 1,
  STATIC_OBSTACLE_POLE: 2,
  DYNAMIC_VEHICLE: 3,
  DYNAMIC_PEDESTRIAN: 4,
  OTHER_UNKNOWN: 5,
};

export const CLASS_COLOR = {
  0: { base: "#4ac26b", label: "Drivable" },
  1: { base: "#e2584f", label: "Static: wall" },
  2: { base: "#c9483f", label: "Static: pole" },
  3: { base: "#e2a23b", label: "Dynamic: vehicle" },
  4: { base: "#f0883a", label: "Dynamic: pedestrian" },
  5: { base: "#8a8f98", label: "Unclassified" },
};

// UI chrome accent (system status, connection, active states) -- kept
// separate from CLASS_COLOR since cyan never appears as a data value.
export const SIGNAL = "#3ccbe8";

export function hexToRgb(hex) {
  const v = hex.replace("#", "");
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
