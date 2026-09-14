import { useOutletContext } from "react-router-dom";
import { useContainerSize } from "../hooks/useContainerSize.js";
import { MAX_RANGE_M } from "../lib/constants.js";
import TopDownLidarCanvas from "../components/TopDownLidarCanvas.jsx";
import SemanticMarker from "../components/SemanticMarker.jsx";
import { ROADSIDE_PROPS } from "../lib/live/roadsideProps.js";

const HAZARD_RANGE_M = 15;
const MAX_LABELED_OBJECTS = 8; // dense demo feeds can carry many tracks -- label only the nearest few

function worldToScreen(rangeM, bearingDeg, scale) {
  const rad = (bearingDeg * Math.PI) / 180;
  const forward = rangeM * Math.cos(rad);
  const right = rangeM * Math.sin(rad);
  return { x: right * scale, y: -forward * scale };
}

/**
 * 360-degree adaptive LiDAR sweep -- car fixed at center pointing "up",
 * exactly like the existing PolarGrid convention (see TopDownLidarCanvas
 * for why this view never rotates the disc). Real grid cells and tracked
 * objects come straight from the shared live feed; roadside props
 * (tree/pole/wall/curb/pothole) are decorative scene dressing, the same
 * icon set the Vehicle HUD uses for the same classes.
 */
export default function TopDownLidarView() {
  const { status, frame } = useOutletContext();
  const [containerRef, containerSize] = useContainerSize();
  const size = Math.max(200, Math.min(containerSize.width, containerSize.height) - 8);
  const margin = 22;
  const scale = (size / 2 - margin) / MAX_RANGE_M;
  const cx = size / 2;
  const cy = size / 2;

  const liveObjects = frame?.objects || [];
  const totalPoints = frame?.grid ? frame.grid.reduce((sum, c) => sum + (c.point_count || 0), 0) : 0;

  const objectMarkers = liveObjects
    .map((obj) => {
      const [fx, fy] = obj.position;
      const bearingDeg = (Math.atan2(fy, fx) * 180) / Math.PI;
      const rangeM = Math.hypot(fx, fy);
      const p = worldToScreen(rangeM, bearingDeg, scale);
      const type = obj.cls === 4 ? "human" : "vehicle";
      return { key: `obj-${obj.track_id}`, type, x: cx + p.x, y: cy + p.y, rangeM };
    })
    .sort((a, b) => a.rangeM - b.rangeM)
    .map((m, i) => ({ ...m, label: i < MAX_LABELED_OBJECTS ? (m.type === "human" ? "HUMAN" : "VEHICLE") : null, size: i < MAX_LABELED_OBJECTS ? 26 : 14 }));

  const propMarkers = ROADSIDE_PROPS.map((prop) => {
    const p = worldToScreen(prop.rangeM, prop.bearingDeg, scale);
    const baseSize = 16;
    return {
      key: prop.id,
      type: prop.type,
      label: prop.type.toUpperCase(),
      x: cx + p.x,
      y: cy + p.y,
      size: prop.type === "pothole" || prop.type === "curb" ? baseSize * prop.sizeScale : baseSize,
    };
  });

  const nearestHazard = objectMarkers.reduce((best, m) => (!best || m.rangeM < best.rangeM ? m : best), null);
  const showHazard = nearestHazard && nearestHazard.rangeM <= HAZARD_RANGE_M;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <div className="flex items-start justify-between px-6 pt-5 pb-3 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-[19px] tracking-wide text-[var(--ink)]">360° ADAPTIVE LIDAR SWEEP</h1>
          <p className="font-mono text-[11px] text-[var(--ink-dim)] mt-1">
            Bird&rsquo;s-eye occupancy-semantic map &middot; radial-ring 2.5D grid, car-centered
          </p>
        </div>
        <span
          className="inline-flex items-center gap-2 font-mono text-[10.5px] tracking-wide px-3 py-1.5 border"
          style={{ color: "var(--safe)", background: "var(--safe-soft)", borderColor: "rgba(74,194,107,0.35)" }}
        >
          <span className="h-[7px] w-[7px] rounded-full pulse-dot" style={{ backgroundColor: "var(--safe)" }} />
          {status === "open" ? "SCANNING" : status?.toUpperCase() || "CONNECTING"}
        </span>
      </div>

      <div ref={containerRef} className="relative flex-1 min-h-0 flex items-center justify-center px-6">
        <div className="relative" style={{ width: size, height: size }}>
          {showHazard && (
            <div
              className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 font-mono text-[11px] tracking-wide px-3.5 py-1.5 border whitespace-nowrap"
              style={{ color: "var(--amber)", background: "var(--amber-soft)", borderColor: "rgba(226,162,59,0.5)" }}
            >
              ⚠ {nearestHazard.type === "human" ? "HUMAN" : "VEHICLE"} — {nearestHazard.rangeM.toFixed(0)}m
            </div>
          )}
          <TopDownLidarCanvas cells={frame?.grid} size={size} showLabels />
          {propMarkers.map((m) => (
            <SemanticMarker key={m.key} type={m.type} label={m.label} x={m.x} y={m.y} size={m.size} />
          ))}
          {objectMarkers.map((m) => (
            <SemanticMarker key={m.key} type={m.type} label={m.label} x={m.x} y={m.y} size={m.size} />
          ))}
          <SemanticMarker type="ego" x={cx} y={cy} size={38} labelAbove={false} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-2.5 font-mono text-[11px]" style={{ color: "var(--ink-dim)" }}>
        <span>
          FPS <b className="font-display" style={{ color: "var(--signal)" }}>{frame?.metrics?.fps?.toFixed(0) ?? "—"}</b>
        </span>
        <span>
          LATENCY{" "}
          <b className="font-display" style={{ color: "var(--signal)" }}>
            {frame?.metrics ? Math.round(frame.metrics.latency_ms) : "—"}MS
          </b>
        </span>
        <span>
          GRID CELLS <b className="font-display" style={{ color: "var(--signal)" }}>{formatIndian(totalPoints)}</b>
        </span>
        <span>
          RINGS <b className="font-display" style={{ color: "var(--signal)" }}>4 BANDS &middot; 5CM&rarr;50CM</b>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-4 font-mono text-[10px] tracking-wide text-[var(--ink-dim)]">
        <LegendDot color="#d6389e" label="Drivable / Road" />
        <LegendDot color="#4ac26b" square label="Non-Drivable / Vegetation" />
        <LegendDot color="#e2584f" square label="Static Obstacle (Wall/Pole/Tree)" />
        <LegendDot color="#e2a23b" label="Dynamic Object (Vehicle/Human)" />
        <LegendDot color="#b25de0" label="Elevation Hazard (Curb/Pothole)" />
      </div>
    </div>
  );
}

function LegendDot({ color, label, square = false }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={`inline-block h-[8px] w-[8px] ${square ? "" : "rounded-full"}`} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function formatIndian(n) {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}
