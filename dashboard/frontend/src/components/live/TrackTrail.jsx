import { useEffect, useRef } from "react";
import { CLASS_COLOR, rgba } from "../../lib/colors.js";
import { rotateByHeading, toIsoScreen } from "../../lib/live/coordinateTransform.js";

/**
 * Motion trails for dynamic objects only -- static objects never get one,
 * per the brief. Reads real position history from useLiveFeed's own
 * `trails` map (already built for CarView/AdminView), so this doesn't
 * duplicate any trail-tracking logic.
 */
export default function TrackTrail({ objects, trails, headingDeg, scale, heightScale, originX, originY, width, height }) {
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

    for (const obj of objects) {
      if (!obj.isDynamic) continue;
      const trail = trails.get(obj.trackId);
      if (!trail || trail.length < 2) continue;
      const color = (CLASS_COLOR[obj.cls] || CLASS_COLOR[5]).base;
      for (let i = 1; i < trail.length; i++) {
        const p0 = rotateByHeading(trail[i - 1][0], trail[i - 1][1], headingDeg);
        const p1 = rotateByHeading(trail[i][0], trail[i][1], headingDeg);
        const s0 = toIsoScreen(p0.forward, p0.right, 0, scale, heightScale);
        const s1 = toIsoScreen(p1.forward, p1.right, 0, scale, heightScale);
        ctx.beginPath();
        ctx.moveTo(originX + s0.x, originY + s0.y);
        ctx.lineTo(originX + s1.x, originY + s1.y);
        ctx.strokeStyle = rgba(color, (i / trail.length) * (obj.alpha ?? 1) * 0.5);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  }, [objects, trails, headingDeg, scale, heightScale, originX, originY, width, height]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}
