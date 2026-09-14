import { useEffect, useRef } from "react";
import { RING_BOUNDARIES, MAX_RANGE_M } from "../lib/constants.js";
import { rgba } from "../lib/colors.js";

const PANEL_BG = "#c7cac8"; // light radar-panel gray, matching the reference sweep
const RING_LINE = "rgba(20,30,30,0.28)";
const DRIVABLE_COLOR = "#d6389e"; // magenta drivable path, this view's own accent
const STATIC_COLOR = "#e2584f";
const DYNAMIC_COLOR = "#e2a23b";
const UNKNOWN_COLOR = "#8a8f98";
const VEGETATION_COLOR = "#4ac26b";

// Fixed decorative vegetation speckle -- purely background texture (the
// real data has no "vegetation" class), computed once so it doesn't
// reshuffle every render.
function makeVegetation() {
  let a = 71 | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clusters = [];
  for (let c = 0; c < 5; c++) {
    const cx = (rand() - 0.5) * 2;
    const cy = (rand() - 0.5) * 2;
    for (let i = 0; i < 26; i++) {
      clusters.push({
        x: cx + (rand() - 0.5) * 0.35,
        y: cy + (rand() - 0.5) * 0.35,
        r: 1 + rand() * 1.8,
      });
    }
  }
  return clusters;
}
const VEGETATION = makeVegetation();

/**
 * Top-down (bird's-eye) LiDAR sweep: car fixed at center pointing "up",
 * exactly like PolarGrid's existing ego-relative convention -- deliberately
 * NO heading-based rotation of the disc. An earlier attempt animated this
 * view by rotating the whole grid to follow a scripted heading, which made
 * the background appear to spin and read as confusing; since this view has
 * no real ego-heading data to justify rotating anything anyway, the fix is
 * simply to never rotate -- only the live cell/object data changes frame to
 * frame, which already reads as "detecting things while moving."
 */
export default function TopDownLidarCanvas({ cells, size = 480, showLabels = true }) {
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
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const margin = showLabels ? 22 : 8;
    const scale = (size / 2 - margin) / MAX_RANGE_M;
    const maxR = MAX_RANGE_M * scale;

    ctx.save();
    ctx.translate(cx, cy);

    for (const v of VEGETATION) {
      const px = v.x * maxR;
      const py = v.y * maxR;
      if (Math.hypot(px, py) > maxR * 0.98) continue;
      ctx.beginPath();
      ctx.arc(px, py, v.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(VEGETATION_COLOR, 0.55);
      ctx.fill();
    }

    if (cells && cells.length) {
      for (const cell of cells) {
        const band = RING_BOUNDARIES[cell.ring];
        if (!band) continue;
        const innerR = band.lo * scale;
        const outerR = band.hi * scale;
        const a0 = degToCanvasAngle(cell.angular_bin * 10);
        const a1 = degToCanvasAngle((cell.angular_bin + 1) * 10);

        const color = cell.cls === 0 ? DRIVABLE_COLOR : cell.cls === 1 || cell.cls === 2 ? STATIC_COLOR : cell.cls === 3 || cell.cls === 4 ? DYNAMIC_COLOR : UNKNOWN_COLOR;
        const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
        const alpha = cell.cls === 0 ? 0.35 + conf * 0.4 : 0.55 + conf * 0.35;

        ctx.beginPath();
        ctx.arc(0, 0, outerR, a0, a1, false);
        ctx.arc(0, 0, Math.max(innerR, 0.001), a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = rgba(color, Math.min(alpha, 0.92));
        ctx.fill();
      }
    }

    ctx.strokeStyle = RING_LINE;
    ctx.lineWidth = 1;
    for (const band of RING_BOUNDARIES) {
      ctx.beginPath();
      ctx.arc(0, 0, band.hi * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Cross-hair spokes, purely a radar-panel reference grid.
    ctx.beginPath();
    ctx.moveTo(-maxR, 0);
    ctx.lineTo(maxR, 0);
    ctx.moveTo(0, -maxR);
    ctx.lineTo(0, maxR);
    ctx.stroke();

    ctx.restore();

    if (showLabels) {
      ctx.font = "10px 'IBM Plex Mono', Consolas, monospace";
      ctx.fillStyle = "rgba(20,30,30,0.6)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const band of RING_BOUNDARIES) {
        if (band.hi === RING_BOUNDARIES[0].hi) continue; // skip the innermost label, too cramped
        const r = band.hi * scale;
        ctx.fillText(`${band.hi}M`, cx + 4, cy - r);
      }
    }
  }, [cells, size, showLabels]);

  return <canvas ref={canvasRef} className="block" />;
}

function degToCanvasAngle(deg) {
  return ((deg - 90) * Math.PI) / 180;
}
