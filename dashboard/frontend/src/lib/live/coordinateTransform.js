// Ego-relative (forward, right, height in meters) -> screen projection for
// the live 2.5D scene, plus the world<->ego-relative transform the
// scripted driving scenario (lib/live/scenario.js) uses to place the road
// backdrop around wherever the ego currently is.
//
// No backend changes are needed to make any of this real: the grid/object
// data useLiveFeed delivers is already ego-relative (the vehicle is always
// the origin of its own sensor frame). Rotating that already-ego-relative
// data by the scripted heading is exactly what a real vehicle-relative
// sensor frame does when the vehicle yaws -- the mock feed is untouched.

/** Rotates an ego-relative (forward, right) point by a heading delta, so
 * world-fixed content visually sweeps as the vehicle turns. Positive
 * headingDeg = turning right (world sweeps left). */
export function rotateByHeading(forwardM, rightM, headingDeg) {
  const rad = (headingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    forward: forwardM * cos - rightM * sin,
    right: forwardM * sin + rightM * cos,
  };
}

/** Full rigid transform: an absolute track-space point (wx, wy) -> the
 * vehicle's current ego-relative frame, given the ego's own absolute
 * (egoX, egoY) and headingDeg from scenario.getEgoPose(). Used only for the
 * scripted road/building backdrop -- real perception data is already
 * ego-relative and never needs this. */
export function worldToEgoRelative(wx, wy, egoX, egoY, egoHeadingDeg) {
  const dx = wx - egoX;
  const dy = wy - egoY;
  const rad = (-egoHeadingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // World forward = +y, right = +x (scenario.js's convention); rotate into
  // the ego's own forward/right axes.
  return {
    forward: dy * cos - dx * sin,
    right: dy * sin + dx * cos,
  };
}

/** Alpha falloff for a forward-biased perception envelope instead of a
 * full-circle radar: full strength within a genuine forward cone, dropping
 * to fully zero well before the sides -- a "flashlight beam ahead", not a
 * disc with dimmer edges. headingDeg: 0 = dead ahead, +-180 = directly
 * behind. */
export function forwardEnvelopeAlpha(headingDeg) {
  const d = Math.abs(((headingDeg + 180) % 360) - 180); // 0..180
  if (d <= 45) return 1;
  if (d >= 95) return 0;
  return 1 - (d - 45) / (95 - 45);
}

// Oblique "2.5D" projection: forward maps to up, right maps to right (same
// orientation PolarGrid/WindshieldView already use), with a vertical
// compression on the forward axis to read as a tilted camera, and height
// raising the point on screen. Deliberately simple -- no 3D engine, no new
// dependency, consistent with the rest of the dashboard's plain-canvas-2D
// rendering.
const CAMERA_TILT = Math.sin((35 * Math.PI) / 180); // ~0.574

export function toIsoScreen(forwardM, rightM, heightM, scalePxPerM, heightScalePxPerM) {
  const groundX = rightM * scalePxPerM;
  const groundY = -forwardM * scalePxPerM * CAMERA_TILT;
  return { x: groundX, y: groundY - heightM * heightScalePxPerM };
}

/** Inverse of toIsoScreen + rotateByHeading, for click-to-select: a screen
 * offset from the scene origin -> the real ego-relative (forward, right)
 * the backend would recognize, i.e. undoing the scripted-heading rotation
 * too. Assumes ground level (height 0) -- close enough for picking which
 * cell/object a click landed near; it doesn't need to be exact. */
export function screenToEgoRelative(dxPx, dyPx, scalePxPerM, headingDeg) {
  const right = dxPx / scalePxPerM;
  const forward = -dyPx / (scalePxPerM * CAMERA_TILT);
  return rotateByHeading(forward, right, -headingDeg);
}
