import { SCENARIO_LABEL } from "../../lib/live/scenario.js";

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function compassLabel(headingDeg) {
  const h = ((headingDeg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(h / 45) % 8];
}

function formatElapsed(tSec) {
  const m = Math.floor(tSec / 60);
  const s = tSec % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Scene-level readout for the scripted demo path -- Time Elapsed/Vehicle
 * Speed/Heading/Position all come straight from scenario.js's own
 * getEgoPose(), the same pose driving the map/camera, so nothing here can
 * drift out of sync with what's on screen. */
export default function SceneInfoPanel({ pose }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
        Scene info
      </span>
      <div className="font-mono text-[10.5px] flex flex-col gap-1" style={{ color: "var(--ink-dim)" }}>
        <Row label="Scenario" value={SCENARIO_LABEL} />
        <Row label="Time elapsed" value={formatElapsed(pose.t)} />
        <Row label="Vehicle speed" value={`${pose.speedKmh.toFixed(1)} km/h`} />
        <Row label="Heading" value={`${pose.headingDeg.toFixed(1)}° (${compassLabel(pose.headingDeg)})`} />
        <Row label="Position (x, y)" value={`(${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}) m`} />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{value}</span>
    </div>
  );
}
