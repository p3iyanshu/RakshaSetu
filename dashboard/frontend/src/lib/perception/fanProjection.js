// Forward-biased fan projection for the Live Perception view's center
// canvas. Reuses the exact true-to-scale polar wedge math
// components/PolarGrid.jsx already uses (meters->pixels linearly, a cell's
// angle measured clockwise from vehicle heading) but anchors the origin
// near the BOTTOM of a wide rectangular canvas instead of the middle of a
// square one.
//
// Real data still covers the full 360 degrees (all 36 angular bins) -- nothing
// is hidden or filtered. Rearward bins simply project to points below the
// origin, where there's only a small margin before the canvas edge, so the
// browser's own canvas clipping keeps them from ever drawing as a complete
// ring. The result reads as a fan fanning out ahead of the vehicle, not a
// disc surrounding it, without needing any bespoke "forward-only" data path.

export function degToCanvasAngle(deg) {
  return ((deg - 90) * Math.PI) / 180;
}

// A grid cell's angular_bin and a tracked object's (x, y) position share the
// same angle space (clockwise from heading, forward = 0deg = "up" on
// screen), so world->screen is a fixed 90-degree rotation.
export function worldToScreen(x, y, scale) {
  return [y * scale, -x * scale];
}

export function screenToWorld(sx, sy, scale) {
  return [-sy / scale, sx / scale];
}

// originY sits close to the bottom of the canvas (vehicle "near the
// bottom-center", per spec) with just enough margin below it for the
// vehicle marker + a sliver of near-field rearward cells.
export function makeFanLayout(width, height, maxRangeM) {
  const originX = width / 2;
  const originY = height * 0.9;
  const topMargin = 18;
  const scale = (originY - topMargin) / maxRangeM; // px per meter, fills the upward space out to maxRangeM
  return { originX, originY, scale, width, height };
}

// Same transform as worldToScreen, but returns absolute canvas-container
// coordinates (origin already added) -- what a DOM-overlaid element (a
// detection card) needs for its own left/top, as opposed to the canvas 2D
// context's already-translated (0,0)-at-origin space.
export function projectPoint(x, y, layout) {
  const [dx, dy] = worldToScreen(x, y, layout.scale);
  return { x: layout.originX + dx, y: layout.originY + dy };
}
