import { useEffect, useRef } from "react";
import { RING_BOUNDARIES, MAX_RANGE_M } from "../lib/constants.js";
import { CLASS_COLOR, rgba } from "../lib/colors.js";

// How wide a windshield/forward-camera field of view to render. Cells and
// objects outside this heading range (or behind the vehicle) simply aren't
// part of a forward HUD's job -- they're still fully visible on the admin
// console's 360-degree top-down radar, nothing is hidden from the system,
// just from this particular real-world-analogous view.
const FOV_DEG = 78;
const FORWARD_RANGE_M = 80; // draw distance -- SemanticKITTI's own useful range

/** Closest real tracked object ahead of the vehicle and inside the
 * windshield FOV, for the HUD's proximity alert -- shared with CarView so
 * the alert text matches exactly what's drawn on the canvas. */
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
 * Forward-perspective "windshield" HUD, matching the RakshaSetu Console
 * reference's instrument-cluster visual metaphor -- but every wedge and
 * marker here is a real projection of the live grid/object data, not an
 * illustrative animation. A cell at (ring, angular_bin) has a genuine
 * (radius, heading) in the vehicle frame; heading=0 is straight ahead
 * (matches PolarGrid's angular_bin*10-degrees-clockwise-from-heading
 * convention). We project (radius, heading) to screen space with the same
 * near-large/far-small vanishing-point math a real forward camera has.
 */
export default function WindshieldView({ cells, objects = [], trails = new Map(), width = 800, height = 480, background = "#0a1213" }) {
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

    const w = width;
    const h = height;
    const carY = h * 0.92;

    // project(radiusM, headingDeg) -> {x, y, scale}. headingDeg: 0 = ahead,
    // +ve = clockwise (right), matches the grid's own angular_bin convention.
    function project(radiusM, headingDeg) {
      const t = Math.max(0, Math.min(1, radiusM / FORWARD_RANGE_M));
      const y = carY - t * h * 0.82;
      const perspective = 0.4 + t * 0.6;
      const xNorm = Math.sin((headingDeg * Math.PI) / 180);
      const x = w / 2 + xNorm * w * 0.62 * perspective;
      return { x, y, scale: 1 - t * 0.62, t };
    }

    function inFov(headingDeg) {
      const d = ((headingDeg + 180) % 360) - 180; // normalize to [-180,180]
      return Math.abs(d) <= FOV_DEG;
    }
    function normDeg(headingDeg) {
      return ((headingDeg + 180) % 360) - 180;
    }

    // faint horizon/lane guide lines for depth cues, matching the
    // reference's cluster stage -- three guide rays fanning from the
    // vehicle, not data, purely a perspective reference grid.
    ctx.strokeStyle = "rgba(60,203,232,0.07)";
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

    // Real grid cells, drawn as forward-projected quads -- the actual
    // segmented terrain/obstacle surface, not a stylized ribbon.
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

        const color = (CLASS_COLOR[cell.cls] || CLASS_COLOR[0]).base;
        const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
        const alpha = cell.cls === 0 ? 0.08 + conf * 0.2 : 0.32 + conf * 0.3;

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

    // Motion trails, projected the same way.
    for (const obj of objects) {
      const trail = trails.get(obj.track_id);
      if (!trail || trail.length < 2) continue;
      const color = (CLASS_COLOR[obj.cls] || CLASS_COLOR[5]).base; // 5 = "unclassified" fallback for an unrecognized cls
      for (let i = 1; i < trail.length; i++) {
        const [fx0, fy0] = trail[i - 1];
        const [fx1, fy1] = trail[i];
        if (fx0 <= 0 || fx1 <= 0) continue;
        const p0 = project(Math.hypot(fx0, fy0), (Math.atan2(fy0, fx0) * 180) / Math.PI);
        const p1 = project(Math.hypot(fx1, fy1), (Math.atan2(fy1, fx1) * 180) / Math.PI);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = rgba(color, (i / trail.length) * 0.5);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Real tracked objects -- projected with genuine near-large/far-small
    // perspective scale, so distance reads visually the way it would
    // through an actual windshield.
    for (const obj of objects) {
      const [fx, fy] = obj.position;
      if (fx <= 0) continue; // behind the vehicle -- not this view's job
      const heading = (Math.atan2(fy, fx) * 180) / Math.PI;
      if (!inFov(heading)) continue;
      const dist = Math.hypot(fx, fy);
      const p = project(dist, heading);
      const color = (CLASS_COLOR[obj.cls] || CLASS_COLOR[5]).base; // 5 = "unclassified" fallback for an unrecognized cls
      const r = Math.max(3, 8 * p.scale);

      ctx.beginPath();
      if (obj.is_dynamic) {
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = background;
      ctx.stroke();
    }

    // Ego hood reference marker.
    ctx.beginPath();
    ctx.moveTo(w / 2, carY - 10);
    ctx.lineTo(w / 2 + 16, carY + 8);
    ctx.lineTo(w / 2 - 16, carY + 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(220,233,231,0.9)";
    ctx.fill();
  }, [cells, objects, trails, width, height, background]);

  return <canvas ref={canvasRef} className="block" />;
}
