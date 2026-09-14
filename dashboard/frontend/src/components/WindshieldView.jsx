import { useEffect, useRef } from "react";
import { RING_BOUNDARIES } from "../lib/constants.js";
import { rgba } from "../lib/colors.js";
import { FOV_DEG, FORWARD_RANGE_M, makeForwardProjector } from "../lib/live/forwardProjection.js";

const DRIVABLE_COLOR = "#4ac26b";
const NON_DRIVABLE_COLOR = "#8a7752"; // tan/khaki shoulder terrain

/** Closest real tracked object ahead of the vehicle and inside the
 * windshield FOV, for the HUD's proximity alert -- shared with CarView so
 * the alert text matches exactly what's drawn on screen. */
export function nearestAheadHazard(objects = []) {
  let nearest = null;
  for (const obj of objects) {
    const [fx, fy] = obj.position;
    if (fx <= 0) continue;
    const heading = (Math.atan2(fy, fx) * 180) / Math.PI;
    if (Math.abs(heading) > FOV_DEG) continue;
    const dist = Math.hypot(fx, fy);
    if (!nearest || dist < nearest.dist) nearest = { dist, cls: obj.cls, isDynamic: obj.is_dynamic };
  }
  return nearest;
}

/**
 * Forward-perspective "windshield" terrain surface: just the drivable/
 * non-drivable ground and motion trails, using genuine (radius, heading)
 * projections of the live grid -- nothing here is illustrative. Discrete
 * obstacles (walls, poles, vehicles, humans, potholes...) are rendered as
 * DOM icon overlays by the view (see VehicleHudView + SemanticMarker), the
 * same terrain/icon split components/live/ already uses for the Live scene,
 * so this canvas only ever draws the ground itself.
 */
export default function WindshieldView({ cells, trails = new Map(), objects = [], width = 800, height = 480, background = "#0a1213" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const { project, inFov } = makeForwardProjector(width, height);

    // Faint horizon/lane guide lines for depth cues -- a perspective
    // reference grid, not data.
    ctx.strokeStyle = "rgba(220,233,231,0.06)";
    ctx.lineWidth = 1;
    [-FOV_DEG, -FOV_DEG / 2, 0, FOV_DEG / 2, FOV_DEG].forEach((deg) => {
      const near = project(0.5, deg);
      const far = project(FORWARD_RANGE_M, deg);
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
      ctx.stroke();
    });
    for (const band of RING_BOUNDARIES) {
      ctx.beginPath();
      let started = false;
      for (let deg = -FOV_DEG; deg <= FOV_DEG; deg += 4) {
        const p = project(band.hi, deg);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Real grid cells, drawn as forward-projected terrain quads: drivable
    // reads as road green, anything else (wall/pole/vehicle/human/unknown)
    // reads as non-drivable shoulder tan -- the discrete obstacle type is
    // conveyed by the icon overlay on top, not by ground color.
    if (cells && cells.length) {
      for (const cell of cells) {
        const heading = normDeg(cell.angular_bin * 10);
        if (!inFov(heading) && !inFov(heading + 10)) continue;
        const band = RING_BOUNDARIES[cell.ring];
        if (!band || band.lo > FORWARD_RANGE_M) continue;
        const r0 = band.lo;
        const r1 = Math.min(band.hi, FORWARD_RANGE_M);
        const a0 = heading;
        const a1 = heading + 10;

        const near0 = project(r0, a0);
        const near1 = project(r0, a1);
        const far1 = project(r1, a1);
        const far0 = project(r1, a0);

        const isDrivable = cell.cls === 0;
        const color = isDrivable ? DRIVABLE_COLOR : NON_DRIVABLE_COLOR;
        const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
        const alpha = isDrivable ? 0.35 + conf * 0.25 : 0.5 + conf * 0.3;

        ctx.beginPath();
        ctx.moveTo(near0.x, near0.y);
        ctx.lineTo(near1.x, near1.y);
        ctx.lineTo(far1.x, far1.y);
        ctx.lineTo(far0.x, far0.y);
        ctx.closePath();
        ctx.fillStyle = rgba(color, Math.min(alpha, 0.85));
        ctx.fill();
      }
    }

    // Lane-center dashed guide down the middle of the drivable lane.
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = "rgba(220,233,231,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const laneNear = project(0.5, 0);
    const laneFar = project(FORWARD_RANGE_M, 0);
    ctx.moveTo(laneNear.x, laneNear.y);
    ctx.lineTo(laneFar.x, laneFar.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Motion trails, projected the same way as icons will be.
    for (const obj of objects) {
      const trail = trails.get(obj.track_id);
      if (!trail || trail.length < 2) continue;
      for (let i = 1; i < trail.length; i++) {
        const [fx0, fy0] = trail[i - 1];
        const [fx1, fy1] = trail[i];
        if (fx0 <= 0 || fx1 <= 0) continue;
        const p0 = project(Math.hypot(fx0, fy0), (Math.atan2(fy0, fx0) * 180) / Math.PI);
        const p1 = project(Math.hypot(fx1, fy1), (Math.atan2(fy1, fx1) * 180) / Math.PI);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = rgba("#e2a23b", (i / trail.length) * 0.4);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  }, [cells, objects, trails, width, height, background]);

  return <canvas ref={canvasRef} className="block" />;
}

function normDeg(headingDeg) {
  return ((headingDeg + 180) % 360) - 180;
}
