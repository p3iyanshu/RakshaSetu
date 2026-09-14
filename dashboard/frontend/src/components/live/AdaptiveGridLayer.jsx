import { useEffect, useRef } from "react";
import { RING_BOUNDARIES } from "../../lib/constants.js";
import { CLASS_COLOR, rgba } from "../../lib/colors.js";
import { rotateByHeading, toIsoScreen, forwardEnvelopeAlpha } from "../../lib/live/coordinateTransform.js";

// A cell's angle (angular_bin * 10 degrees) is clockwise from the vehicle
// heading, matching PolarGrid/WindshieldView's existing convention.
function wedgeCornersEgoRelative(band, angularBin) {
  const a0 = angularBin * 10;
  const a1 = (angularBin + 1) * 10;
  const pt = (r, aDeg) => {
    const rad = (aDeg * Math.PI) / 180;
    return { forward: r * Math.cos(rad), right: r * Math.sin(rad) };
  };
  return [pt(band.lo, a0), pt(band.hi, a0), pt(band.hi, a1), pt(band.lo, a1)];
}

const HEIGHT_CLAMP_M = 2.5; // a 2.5m rise already reads clearly at this scale

/**
 * The adaptive polar grid, rendered with real height extrusion: each
 * occupied cell draws a dim ground-level base plus a roof raised by its
 * real height_mean, so elevation is visibly, not just numerically, present.
 * Ring boundaries stay genuinely true-to-scale (thicker + wider arcs at
 * range), same as PolarGrid -- this view only adds the iso tilt + height.
 */
export default function AdaptiveGridLayer({ cells, headingDeg, scale, heightScale, originX, originY, width, height, selectedCellKey }) {
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

    function project(forward, right, h) {
      const rotated = rotateByHeading(forward, right, headingDeg);
      const s = toIsoScreen(rotated.forward, rotated.right, h, scale, heightScale);
      return { x: originX + s.x, y: originY + s.y };
    }

    function fillWedge(corners, h, color, alpha) {
      ctx.beginPath();
      corners.forEach((c, i) => {
        const p = project(c.forward, c.right, h);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = rgba(color, alpha);
      ctx.fill();
    }

    for (const cell of cells) {
      if (cell.alpha <= 0.01) continue;
      const band = RING_BOUNDARIES[cell.ring];
      if (!band) continue;
      const centerDeg = cell.angular_bin * 10 + 5;
      // Forward perception envelope, not a full radar circle -- cells well
      // to the side/behind fade toward invisible rather than drawing a
      // complete 360deg disc. Real data is untouched; this is a display
      // emphasis choice only.
      const envelope = forwardEnvelopeAlpha(centerDeg);
      if (envelope <= 0.02) continue;
      const corners = wedgeCornersEgoRelative(band, cell.angular_bin);
      const color = (CLASS_COLOR[cell.cls] || CLASS_COLOR[0]).base;
      const conf = typeof cell.confidence === "number" ? cell.confidence : 0.8;
      const h = Math.min(Math.max(cell.height, 0), HEIGHT_CLAMP_M);
      const a = cell.alpha * envelope;

      // Ground-level base -- a dim shadow, grounds the roof visually.
      fillWedge(corners, 0, color, (cell.cls === 0 ? 0.07 + conf * 0.13 : 0.12) * a);

      // Roof, raised by the real height -- the actual elevation extrusion.
      // Flat (drivable) cells have h≈0 so the roof sits on the ground.
      // Muted, technical alpha range -- no neon saturation.
      if (h > 0.02) {
        fillWedge(corners, h, color, Math.min(0.78, 0.3 + conf * 0.32) * a);
      }

      // A bright outline on whichever cell the user last clicked -- what
      // the Elevation panel is currently showing.
      if (selectedCellKey && `${cell.ring}_${cell.angular_bin}` === selectedCellKey) {
        ctx.beginPath();
        corners.forEach((c, i) => {
          const p = project(c.forward, c.right, h);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.strokeStyle = "var(--signal, #3ccbe8)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    // Ring boundary guides, iso-projected -- where each resolution band
    // starts/ends. Deliberately an open arc, not a closed circle: a full
    // ring reads as a radar display, which is exactly the look this scene
    // is meant to avoid. Drawn only across the forward envelope, and only
    // for the two inner (most legible, most relevant) bands -- the outer
    // ones would mostly sit off the visible road anyway.
    ctx.strokeStyle = "rgba(180,196,193,0.16)";
    ctx.lineWidth = 1;
    for (const band of RING_BOUNDARIES.slice(0, 3)) {
      ctx.beginPath();
      let started = false;
      for (let deg = -90; deg <= 90; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const p = project(band.hi * Math.cos(rad), band.hi * Math.sin(rad), 0);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }, [cells, headingDeg, scale, heightScale, originX, originY, width, height, selectedCellKey]);

  return <canvas ref={canvasRef} className="absolute inset-0" />;
}
