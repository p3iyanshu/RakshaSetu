import { useEffect, useRef } from "react";
import { worldToEgoRelative, rotateByHeading, toIsoScreen } from "../../lib/live/coordinateTransform.js";
import { ROAD_SEGMENTS, ROAD_WIDTH_M, BUILDING_BLOCKS } from "../../lib/live/scenario.js";

/**
 * The scripted road + building backdrop the vehicle is driving through --
 * purely atmospheric staging (unlabeled, no track IDs, no confidence): it
 * exists so the scene reads as "a street", not an empty perception void.
 * Every tagged/tracked detection in the scene still comes exclusively from
 * the real backend feed via useLiveFeed -- this component never invents one.
 */
export default function RoadEnvironment({ egoX, egoY, egoHeadingDeg, scale, heightScale, originX, originY, width, height, fade }) {
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
    ctx.globalAlpha = fade;

    function projectWorld(wx, wy, h = 0) {
      const rel = worldToEgoRelative(wx, wy, egoX, egoY, egoHeadingDeg);
      const s = toIsoScreen(rel.forward, rel.right, h, scale, heightScale);
      return { x: originX + s.x, y: originY + s.y };
    }

    // Road surface -- a flat dark-gray ribbon following the scripted path,
    // widened perpendicular to each segment's own direction.
    ctx.fillStyle = "rgba(30,36,37,0.9)";
    for (const seg of ROAD_SEGMENTS) {
      const dx = seg.to.x - seg.from.x;
      const dy = seg.to.y - seg.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (ROAD_WIDTH_M / 2);
      const ny = (dx / len) * (ROAD_WIDTH_M / 2);
      const corners = [
        projectWorld(seg.from.x + nx, seg.from.y + ny),
        projectWorld(seg.to.x + nx, seg.to.y + ny),
        projectWorld(seg.to.x - nx, seg.to.y - ny),
        projectWorld(seg.from.x - nx, seg.from.y - ny),
      ];
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.fill();

      // Center dashed lane line.
      ctx.save();
      ctx.strokeStyle = "rgba(150,160,158,0.35)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 7]);
      const from = projectWorld(seg.from.x, seg.from.y);
      const to = projectWorld(seg.to.x, seg.to.y);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    }

    // Building silhouettes -- dim rectangular blocks with a slight
    // extrusion, just enough to read as "structures alongside the road".
    for (const b of BUILDING_BLOCKS) {
      const baseH = 6;
      const corners0 = [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h],
      ];
      const roof = corners0.map(([wx, wy]) => projectWorld(wx, wy, baseH));
      ctx.beginPath();
      roof.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(24,30,31,0.7)";
      ctx.fill();
      ctx.strokeStyle = "rgba(60,203,232,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [egoX, egoY, egoHeadingDeg, scale, heightScale, originX, originY, width, height, fade]);

  return <canvas ref={canvasRef} className="absolute inset-0" />;
}
