// Shared forward-perspective projection for the Vehicle HUD windshield
// view. Both the terrain canvas (WindshieldView) and the DOM-overlaid
// object/prop icons (VehicleHudView) must use the exact same math, or an
// icon would drift off the wedge it's supposed to sit on.
//
// Near objects render WIDE (large screen spread, large scale) and far
// objects render NARROW, converging toward a vanishing point at the
// horizon -- an inverted-V silhouette, matching how a real road recedes
// from a driver's seat. (A previous version of this view had the ratio
// backwards -- wide at the horizon, narrow at the car -- which read as a
// plain "V" and looked wrong.)
export const FOV_DEG = 78;
export const FORWARD_RANGE_M = 80;

export function makeForwardProjector(width, height) {
  const carY = height * 0.92;

  function project(radiusM, headingDeg) {
    const t = Math.max(0, Math.min(1, radiusM / FORWARD_RANGE_M));
    const y = carY - t * height * 0.82;
    const perspective = 1 - t * 0.6; // 1 = wide (near), 0.4 = narrow (far)
    const xNorm = Math.sin((headingDeg * Math.PI) / 180);
    const x = width / 2 + xNorm * width * 0.62 * perspective;
    const scale = 1 - t * 0.62; // near-large / far-small marker scale
    return { x, y, scale, t };
  }

  function inFov(headingDeg) {
    const d = ((headingDeg + 180) % 360) - 180;
    return Math.abs(d) <= FOV_DEG;
  }

  return { project, inFov, carY };
}
