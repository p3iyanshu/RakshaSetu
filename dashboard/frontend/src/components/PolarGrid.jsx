import { useEffect, useRef } from "react";
import { RING_BOUNDARIES, MAX_RANGE_M } from "../lib/constants.js";
import { CLASS_COLOR, rgba } from "../lib/colors.js";

/**
 * Top-down (bird's-eye) render of the adaptive polar occupancy grid: 4
 * rings with genuinely different real-world radial spans (0-10m, 10-30m,
 * 30-60m, 60-100m), each swept into 36 angular bins (10deg each). Cell size
 * grows toward the edges purely from true-to-scale linear meters->pixels
 * mapping -- both the ring's radial thickness AND each bin's arc width at
 * that radius grow with distance, which is the actual thing being
 * demonstrated.
 *
 * Coordinate convention: a cell's angle (angular_bin * 10 degrees) is
 * measured clockwise from the vehicle heading, heading pointing "up" on
 * screen. A tracked object's raw (x, y) position uses the same convention
 * implicitly -- x = r*cos(angle), y = r*sin(angle) in the same angle space
 * -- so world->screen for an object reduces to a fixed 90-degree rotation:
 * screenX = y * scale, screenY = -x * scale. Both the grid wedges and the
 * object markers go through equivalent transforms so a marker always lands
 * inside the wedge that was colored for it.
 */
export default function PolarGrid({
  cells,
  objects = [],
  trails = new Map(),
  size = 480,
  showLabels = true,
  background = "#07100b",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const margin = showLabels ? 22 : 8;
    const scale = (size / 2 - margin) / MAX_RANGE_M; // px per meter

    ctx.save();
    ctx.translate(cx, cy);

    // Background disc so ungenerated / out-of-range space still reads as
    // "known dark ground" rather than raw panel background.
    ctx.beginPath();
    ctx.arc(0, 0, MAX_RANGE_M * scale, 0, Math.PI * 2);
    ctx.fillStyle = background;
    ctx.fill();

    if (cells && cells.length) {
      for (const cell of cells) {
        const band = RING_BOUNDARIES[cell.ring];
        if (!band) continue;
        const innerR = band.lo * scale;
        const outerR = band.hi * scale;
        const a0 = degToCanvasAngle(cell.angular_bin * 10);
        const a1 = degToCanvasAngle((cell.angular_bin + 1) * 10);

        const color = (CLASS_COLOR[cell.cls] || CLASS_COLOR[0]).base;
        const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
        const alpha = cell.cls === 0 ? 0.1 + conf * 0.26 : 0.5 + conf * 0.42;

        ctx.beginPath();
        ctx.arc(0, 0, outerR, a0, a1, false);
        ctx.arc(0, 0, Math.max(innerR, 0.001), a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = rgba(color, Math.min(alpha, 0.95));
        ctx.fill();
        // hairline gap between wedges, in the surface color -- the same
        // "surface gap" mechanism used for stacked bars, adapted to a grid
        ctx.lineWidth = 1;
        ctx.strokeStyle = background;
        ctx.stroke();
      }
    }

    // Ring boundary circles -- recessive, but crisp enough that reviewers
    // can see exactly where each resolution band starts/ends.
    ctx.strokeStyle = "rgba(60,203,232,0.28)";
    ctx.lineWidth = 1;
    for (const band of RING_BOUNDARIES) {
      ctx.beginPath();
      ctx.arc(0, 0, band.hi * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Motion trails (drawn under object markers), fading with age.
    for (const obj of objects) {
      const trail = trails.get(obj.track_id);
      if (!trail || trail.length < 2) continue;
      const color = (CLASS_COLOR[obj.cls] || CLASS_COLOR[5]).base; // 5 = "unclassified" fallback for an unrecognized cls
      for (let i = 1; i < trail.length; i++) {
        const [x0, y0] = worldToScreen(trail[i - 1][0], trail[i - 1][1], scale);
        const [x1, y1] = worldToScreen(trail[i][0], trail[i][1], scale);
        const alpha = (i / trail.length) * 0.45;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Object markers.
    for (const obj of objects) {
      const [px, py] = worldToScreen(obj.position[0], obj.position[1], scale);
      const color = (CLASS_COLOR[obj.cls] || CLASS_COLOR[5]).base; // 5 = "unclassified" fallback for an unrecognized cls
      ctx.beginPath();
      if (obj.is_dynamic) {
        // diamond for dynamic
        const r = 7;
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py);
        ctx.closePath();
      } else {
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = background;
      ctx.stroke();
    }

    // Ego vehicle marker: triangle pointing "up" (forward / heading).
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fillStyle = "#dce9e7";
    ctx.shadowColor = "rgba(60,203,232,0.6)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();

    if (showLabels) {
      ctx.font = "10px 'IBM Plex Mono', Consolas, monospace";
      ctx.fillStyle = "rgba(220,233,231,0.5)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const band of RING_BOUNDARIES) {
        const r = band.hi * scale;
        ctx.fillText(`${band.hi}m`, cx + 3, cy - r);
      }
    }
  }, [cells, objects, trails, size, showLabels, background]);

  return <canvas ref={canvasRef} className="block" />;
}

function degToCanvasAngle(deg) {
  return ((deg - 90) * Math.PI) / 180;
}

// A tracked object's (x, y) sits in the same angle space as the grid's
// angular_bin (angle measured clockwise from heading, forward = angle 0).
// Rotating that space by -90 degrees to match canvas angle 0 = "up" reduces
// to a fixed swap: screenX = y * scale, screenY = -x * scale.
function worldToScreen(x, y, scale) {
  return [y * scale, -x * scale];
}
