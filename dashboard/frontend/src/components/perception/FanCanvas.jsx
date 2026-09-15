import { useEffect, useRef } from "react";
import { RING_BOUNDARIES } from "../../lib/constants.js";
import { CLASS_COLOR, rgba } from "../../lib/colors.js";
import { degToCanvasAngle, worldToScreen } from "../../lib/perception/fanProjection.js";

const HEIGHT_SCALE_PX_PER_M = 14; // the actual "2.5D": taller real height_max -> taller extrusion
const HEIGHT_EXTRUDE_THRESHOLD_M = 0.15; // skip extruding near-flat ground noise
const HEIGHT_EXTRUDE_CAP_M = 3; // cap absurd outliers so one tall cell doesn't dominate the scene
const SWEEP_DEG_PER_S = 45; // decorative only -- never gates what data renders
const VELOCITY_ARROW_SCALE = 0.9; // seconds of travel drawn as the arrow's length

/** Extruded wedge (base footprint + side wall + lightened top face) for a
 * true ring/angular_bin grid cell -- the vertical "2.5D" pop this project is
 * named for, driven by the cell's own real height_max. */
function drawExtrudedWedge(ctx, innerR, outerR, a0, a1, color, alpha, heightM, strokeColor) {
  const h = Math.min(Math.max(heightM, 0), HEIGHT_EXTRUDE_CAP_M);
  const extrusion = h * HEIGHT_SCALE_PX_PER_M;

  ctx.beginPath();
  ctx.arc(0, 0, outerR, a0, a1, false);
  ctx.arc(0, 0, Math.max(innerR, 0.001), a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = rgba(color, alpha * (extrusion > 1.5 ? 0.5 : 1));
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  if (extrusion > 1.5) {
    const x0 = outerR * Math.cos(a0), y0 = outerR * Math.sin(a0);
    const x1 = outerR * Math.cos(a1), y1 = outerR * Math.sin(a1);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 - extrusion);
    ctx.lineTo(x0, y0 - extrusion);
    ctx.closePath();
    ctx.fillStyle = rgba(color, alpha * 0.65);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -extrusion, outerR, a0, a1, false);
    ctx.arc(0, -extrusion, Math.max(innerR, 0.001), a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = rgba(color, Math.min(0.95, alpha + 0.2));
    ctx.fill();
    ctx.stroke();
  }
}

/** Same extrusion idea for a world-buffer "ghost" entry, which no longer has
 * clean ring/angular_bin geometry once re-projected (it's an arbitrary world
 * position) -- drawn as a small axis-aligned block instead of a wedge. */
function drawExtrudedBlock(ctx, cx, cy, sizePx, color, alpha, heightM) {
  const h = Math.min(Math.max(heightM, 0), HEIGHT_EXTRUDE_CAP_M);
  const extrusion = h * HEIGHT_SCALE_PX_PER_M;
  const half = sizePx / 2;

  ctx.fillStyle = rgba(color, alpha * 0.4);
  ctx.fillRect(cx - half, cy - half, sizePx, sizePx);

  if (extrusion > 1.5) {
    ctx.fillStyle = rgba(color, alpha * 0.55);
    ctx.fillRect(cx - half, cy - half - extrusion, sizePx, extrusion);
    ctx.fillStyle = rgba(color, alpha * 0.75);
    ctx.fillRect(cx - half, cy - half - extrusion, sizePx, sizePx);
  }
}

/**
 * The center canvas for Live Perception: a forward-biased fan, not a radar
 * disc. Plain <canvas> 2D, same technique as PolarGrid.jsx (true-to-scale
 * linear meters->pixels wedges, so cell size visibly grows with range) --
 * the only real difference is where the origin sits. PolarGrid centers the
 * origin in a square canvas, which reads as a full disc; this anchors the
 * origin near the BOTTOM of a wide rectangle instead, so only a forward arc
 * fits inside the canvas bounds and everything behind the vehicle is
 * naturally clipped rather than hidden by any per-bin filtering.
 *
 * `layout` ({originX, originY, scale}) is computed once by the parent
 * (lib/perception/fanProjection.js's makeFanLayout) and passed in rather
 * than recomputed here, so the DOM-overlaid detection cards use the exact
 * same coordinate space as this canvas. `nowMs` is a continuously-advancing
 * timestamp from the parent's animation loop (usePerceptionAnimation) so the
 * scan-sweep and detection-callout glow animate every frame, not only when
 * `cells`/`objects` themselves change.
 */
export default function FanCanvas({
  cells = [],
  objects = [],
  bufferedCells = [],
  trails = new Map(),
  width,
  height,
  layout,
  nowMs = 0,
  selectedCellKey,
  selectedTrackId,
  onSelectCell,
  onSelectObject,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0 || !layout) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#07100b";
    ctx.fillRect(0, 0, width, height);

    const { originX, originY, scale } = layout;

    ctx.save();
    ctx.translate(originX, originY);

    // World-buffer "ghost" static geometry underneath the live grid -- what
    // makes buildings/walls persist and reveal as the vehicle drives instead
    // of the scene redrawing from a blank grid every frame.
    for (const g of bufferedCells) {
      const [px, py] = worldToScreen(g.x, g.y, scale);
      const color = (CLASS_COLOR[g.cls] ?? CLASS_COLOR[5]).base;
      drawExtrudedBlock(ctx, px, py, 6, color, g.alpha * 0.7, g.heightMax);
    }

    if (cells && cells.length) {
      for (const cell of cells) {
        const band = RING_BOUNDARIES[cell.ring];
        if (!band) continue;
        const innerR = band.lo * scale;
        const outerR = band.hi * scale;
        const a0 = degToCanvasAngle(cell.angular_bin * 10);
        const a1 = degToCanvasAngle((cell.angular_bin + 1) * 10);

        const color = (CLASS_COLOR[cell.cls] || CLASS_COLOR[5]).base;
        const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
        const alpha = cell.cls === 0 ? 0.1 + conf * 0.26 : 0.5 + conf * 0.42;
        const key = `${cell.ring}_${cell.angular_bin}`;
        const heightM = cell.cls === 0 ? 0 : cell.height_max; // drivable stays flat even if noisy height_max sneaks in

        drawExtrudedWedge(
          ctx, innerR, outerR, a0, a1, color, Math.min(alpha, 0.95),
          heightM > HEIGHT_EXTRUDE_THRESHOLD_M ? heightM : 0,
          key === selectedCellKey ? "#f4f7f6" : "#07100b"
        );
        if (key === selectedCellKey) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#f4f7f6";
          ctx.beginPath();
          ctx.arc(0, 0, outerR, a0, a1, false);
          ctx.arc(0, 0, Math.max(innerR, 0.001), a1, a0, true);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    // Ring boundaries -- recessive arcs so a reviewer can see exactly where
    // each resolution band starts/ends. Only the arc segment that falls
    // within the canvas actually shows -- this is what makes the shape read
    // as a fan instead of a ring: the browser clips the rest for free.
    ctx.strokeStyle = "rgba(60,203,232,0.28)";
    ctx.lineWidth = 1;
    for (const band of RING_BOUNDARIES) {
      ctx.beginPath();
      ctx.arc(0, 0, band.hi * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Scan-sweep: a decorative "actively scanning" cue radiating from the
    // ego marker. Purely a UI affordance layered over real data -- it never
    // gates what's drawn above, only how it's drawn on top.
    const sweepDeg = (nowMs / 1000) * SWEEP_DEG_PER_S;
    const sweepRad = degToCanvasAngle(sweepDeg);
    const sweepLen = RING_BOUNDARIES[RING_BOUNDARIES.length - 1].hi * scale;
    const sweepGrad = ctx.createLinearGradient(0, 0, sweepLen * Math.cos(sweepRad), sweepLen * Math.sin(sweepRad));
    sweepGrad.addColorStop(0, "rgba(60,203,232,0.35)");
    sweepGrad.addColorStop(1, "rgba(60,203,232,0)");
    ctx.beginPath();
    ctx.arc(0, 0, sweepLen, sweepRad - 0.12, sweepRad, false);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = sweepGrad;
    ctx.fill();

    // Dynamic-object trails (static objects never get one). Reuses
    // useLiveFeed's own per-track_id position history, same convention
    // PolarGrid already renders trails with.
    for (const obj of objects) {
      if (!obj.is_dynamic) continue;
      const trail = trails.get(obj.track_id);
      if (!trail || trail.length < 2) continue;
      const color = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).base;
      for (let i = 1; i < trail.length; i++) {
        const [x0, y0] = worldToScreen(trail[i - 1][0], trail[i - 1][1], scale);
        const [x1, y1] = worldToScreen(trail[i][0], trail[i][1], scale);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = rgba(color, (i / trail.length) * 0.5);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Tracked-object markers, velocity arrows (dynamic only, using the real
    // ego-motion-compensated `velocity` field -- never velocity_relative),
    // and a fading detection-callout glow for newly-confirmed tracks.
    for (const obj of objects) {
      const [px, py] = worldToScreen(obj.position[0], obj.position[1], scale);
      const color = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).base;
      const isSelected = obj.track_id === selectedTrackId;

      if (obj.is_dynamic && (obj.velocity[0] !== 0 || obj.velocity[1] !== 0)) {
        const [vx, vy] = worldToScreen(
          obj.position[0] + obj.velocity[0] * VELOCITY_ARROW_SCALE,
          obj.position[1] + obj.velocity[1] * VELOCITY_ARROW_SCALE,
          scale
        );
        const dx = vx - px, dy = vy - py;
        const len = Math.hypot(dx, dy);
        if (len > 3) {
          const ux = dx / len, uy = dy / len;
          ctx.strokeStyle = rgba(color, 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(vx, vy);
          ctx.stroke();
          const headSize = 5;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx - ux * headSize - uy * headSize * 0.6, vy - uy * headSize + ux * headSize * 0.6);
          ctx.lineTo(vx - ux * headSize + uy * headSize * 0.6, vy - uy * headSize - ux * headSize * 0.6);
          ctx.closePath();
          ctx.fillStyle = rgba(color, 0.85);
          ctx.fill();
        }
      }

      if (obj.glowAlpha > 0) {
        ctx.beginPath();
        ctx.arc(px, py, 8 + (1 - obj.glowAlpha) * 16, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color, obj.glowAlpha * 0.7);
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      if (obj.is_dynamic) {
        const r = isSelected ? 9 : 7;
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py);
        ctx.closePath();
      } else {
        ctx.arc(px, py, isSelected ? 7 : 5.5, 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.strokeStyle = isSelected ? "#f4f7f6" : "#07100b";
      ctx.stroke();
    }

    // Ego vehicle marker, pointing "up" (forward).
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 6);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fillStyle = "#dce9e7";
    ctx.shadowColor = "rgba(60,203,232,0.6)";
    ctx.shadowBlur = 7;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();

    // Range-ring labels along the vertical (forward) axis.
    ctx.font = "10px 'IBM Plex Mono', Consolas, monospace";
    ctx.fillStyle = "rgba(220,233,231,0.5)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const band of RING_BOUNDARIES) {
      const y = originY - band.hi * scale;
      if (y < 4) continue;
      ctx.fillText(`${band.hi}m`, originX + 4, y);
    }
  }, [cells, objects, bufferedCells, trails, width, height, layout, nowMs, selectedCellKey, selectedTrackId]);

  function handleClick(e) {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - layout.originX;
    const dy = e.clientY - rect.top - layout.originY;
    // Inverse of worldToScreen: screenX = y*scale, screenY = -x*scale.
    const worldX = -dy / layout.scale;
    const worldY = dx / layout.scale;

    // Hit-test tracked objects first (small, precise targets).
    for (const obj of objects) {
      const [px, py] = worldToScreen(obj.position[0], obj.position[1], layout.scale);
      if (Math.hypot(dx - px, dy - py) <= 10) {
        onSelectObject?.(obj.track_id);
        return;
      }
    }

    const rangeM = Math.hypot(worldX, worldY);
    const bearingDeg = (((Math.atan2(worldY, worldX) * 180) / Math.PI) % 360 + 360) % 360;
    const ringIdx = RING_BOUNDARIES.findIndex((b) => rangeM >= b.lo && rangeM < b.hi);
    if (ringIdx === -1) {
      onSelectCell?.(null);
      return;
    }
    const angularBin = Math.floor(bearingDeg / 10);
    onSelectCell?.(`${ringIdx}_${angularBin}`);
  }

  return <canvas ref={canvasRef} className="block cursor-pointer" onClick={handleClick} />;
}
