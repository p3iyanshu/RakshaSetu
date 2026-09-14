import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useContainerSize } from "../hooks/useContainerSize.js";
import WindshieldView, { nearestAheadHazard } from "../components/WindshieldView.jsx";
import SemanticMarker from "../components/SemanticMarker.jsx";
import { CLASS_COLOR } from "../lib/colors.js";
import { FOV_DEG, FORWARD_RANGE_M, makeForwardProjector } from "../lib/live/forwardProjection.js";
import { forwardProps } from "../lib/live/roadsideProps.js";

const HAZARD_ALERT_RANGE_M = 20;
const MAX_LABELED_OBJECTS = 6; // dense demo feeds can carry many tracks -- label only the nearest few
const GEARS = ["P", "R", "N", "D"];

/** Ego speed isn't part of the live-feed data contract (only object
 * velocity/position and grid metrics are) -- this is a smooth decorative
 * readout, not real telemetry, matching the reference HUD's speed dial. */
function useDisplaySpeedKmh() {
  const [speed, setSpeed] = useState(18);
  useEffect(() => {
    const id = setInterval(() => setSpeed(18 + Math.round(6 * Math.sin(Date.now() / 4000))), 500);
    return () => clearInterval(id);
  }, []);
  return speed;
}

/**
 * Onboard HUD -- a forward "windshield" view matching the RakshaSetu
 * Console reference's instrument-cluster metaphor: real terrain/objects
 * projected with true near-wide/far-narrow perspective, discrete obstacles
 * shown as semantic icons (shared with the Top-Down LiDAR view), decorative
 * roadside props (tree/pole/wall/curb/pothole) filling in the scene the
 * live data doesn't classify that finely. Lives inside DashboardLayout,
 * which owns the live-feed connection and passes it down via Outlet
 * context.
 */
export default function CarView() {
  const { frame, trails } = useOutletContext();
  const [containerRef, size] = useContainerSize();
  const [mode, setMode] = useState("drdo");
  const [gear, setGear] = useState("D");
  const speedKmh = useDisplaySpeedKmh();

  const width = Math.max(320, size.width - 4);
  const height = Math.max(240, size.height - 4);
  const { project, inFov } = makeForwardProjector(width, height);

  const nearest = frame?.objects ? nearestAheadHazard(frame.objects) : null;
  const showAlert = nearest && nearest.dist <= HAZARD_ALERT_RANGE_M;
  const alertColor = nearest ? (CLASS_COLOR[nearest.cls] || CLASS_COLOR[5]).base : "var(--amber)";
  const alertLabel = nearest ? (CLASS_COLOR[nearest.cls] || CLASS_COLOR[5]).label.replace(/^.*:\s*/, "") : "";

  const totalPoints = frame?.grid ? frame.grid.reduce((sum, c) => sum + (c.point_count || 0), 0) : 0;

  const dynamicMarkers = (frame?.objects || [])
    .filter((obj) => {
      const [fx, fy] = obj.position;
      if (fx <= 0) return false;
      const heading = (Math.atan2(fy, fx) * 180) / Math.PI;
      return inFov(heading) && Math.hypot(fx, fy) <= FORWARD_RANGE_M;
    })
    .map((obj) => {
      const [fx, fy] = obj.position;
      const heading = (Math.atan2(fy, fx) * 180) / Math.PI;
      const dist = Math.hypot(fx, fy);
      const p = project(dist, heading);
      const type = obj.cls === 4 ? "human" : "vehicle";
      return { key: `obj-${obj.track_id}`, type, dist, x: p.x, y: p.y, size: Math.max(20, 34 * p.scale) };
    })
    .sort((a, b) => a.dist - b.dist)
    // Dense demo feeds can carry many tracks -- label only the nearest few,
    // the rest still render as small unlabeled icons.
    .map((m, i) => ({ ...m, label: i < MAX_LABELED_OBJECTS ? (m.type === "human" ? "HUMAN" : "VEHICLE") : null }));

  const propMarkers = forwardProps(FOV_DEG, FORWARD_RANGE_M).map((p) => {
    const proj = project(p.rangeM, p.bearingDeg > 180 ? p.bearingDeg - 360 : p.bearingDeg);
    const baseSize = 18 * proj.scale;
    return {
      key: p.id,
      type: p.type,
      label: p.type.toUpperCase(),
      x: proj.x,
      y: proj.y,
      size: (p.type === "pothole" || p.type === "curb" ? baseSize * p.sizeScale : baseSize) + 4,
    };
  });

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <div className="flex items-center justify-between px-6 py-3 flex-wrap gap-3">
        <div className="leading-none">
          <span className="font-display font-bold text-[40px] text-[var(--ink)]">{speedKmh}</span>
          <span className="font-mono text-[12px] text-[var(--ink-dim)] uppercase ml-2">km/h</span>
        </div>

        <div className="flex items-center gap-2">
          {GEARS.map((g) => (
            <button
              key={g}
              onClick={() => setGear(g)}
              className="w-9 h-9 rounded-full font-display font-bold text-[13px] border transition-colors"
              style={
                gear === g
                  ? { color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)" }
                  : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
              }
            >
              {g}
            </button>
          ))}
        </div>

        <div
          className="flex items-center gap-2 font-mono text-[11px] tracking-wide px-3.5 py-1.5 border"
          style={
            showAlert
              ? { color: alertColor, background: `${alertColor}22`, borderColor: `${alertColor}80` }
              : { color: "var(--safe)", background: "var(--safe-soft)", borderColor: "rgba(74,194,107,0.35)" }
          }
        >
          <span className="h-[7px] w-[7px] rounded-full pulse-dot" style={{ backgroundColor: showAlert ? alertColor : "var(--safe)" }} />
          {showAlert ? `${alertLabel.toUpperCase()} — ${nearest.dist.toFixed(0)}M AHEAD` : "ADAPTIVE PERCEPTION ACTIVE"}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 mx-6 mb-3 border overflow-hidden"
        style={{ borderColor: "var(--line)", background: "#0a1213" }}
      >
        <WindshieldView cells={frame?.grid} objects={frame?.objects || []} trails={trails} width={width} height={height} background="#0a1213" />

        {propMarkers.map((m) => (
          <SemanticMarker key={m.key} type={m.type} label={m.label} x={m.x} y={m.y} size={m.size} />
        ))}
        {dynamicMarkers.map((m) => (
          <SemanticMarker key={m.key} type={m.type} label={m.label} x={m.x} y={m.y} size={m.size} />
        ))}
        <SemanticMarker type="ego" x={width / 2} y={height * 0.92} size={40} labelAbove={false} />
      </div>

      <div className="flex items-center justify-between px-6 pb-4 flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]" style={{ color: "var(--ink-dim)" }}>
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
            MODE <b className="font-display" style={{ color: "var(--signal)" }}>ADAPTIVE 2.5D</b>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode("drdo")}
            className="font-display text-[10.5px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-colors"
            style={
              mode === "drdo"
                ? { color: "var(--ground)", background: "var(--amber)", borderColor: "var(--amber)" }
                : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
            }
          >
            DRDO UGV Mode
          </button>
          <button
            onClick={() => setMode("civilian")}
            className="font-display text-[10.5px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-colors"
            style={
              mode === "civilian"
                ? { color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)" }
                : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
            }
          >
            Civilian ADAS Mode
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-3 font-mono text-[10px] tracking-wide text-[var(--ink-dim)]">
        <LegendDot color="#4ac26b" label="Drivable Terrain" />
        <LegendDot color="#8a7752" square label="Non-Drivable Terrain" />
        <LegendDot color="#e2584f" square label="Static Obstacle" />
        <LegendDot color="#e2a23b" label="Dynamic Object" />
        <LegendDot color="#b25de0" label="Elevation Hazard" />
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
