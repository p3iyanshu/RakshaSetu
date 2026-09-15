import Panel from "./Panel.jsx";

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[10.5px]">
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }} className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * SCENE INFO -- scenario label + real ego pose (once Phase 1 supplies it).
 * `pose` is null when the feed has no ego_pose yet (older data / mock
 * fallback) -- that's shown honestly as "--", never fabricated.
 */
export default function SceneInfoPanel({ scenario, timeElapsedS, pose }) {
  const hasPose = pose != null;
  return (
    <Panel title="Scene Info">
      <div className="flex flex-col gap-1.5">
        <Row label="SCENARIO" value={scenario ?? "—"} />
        <Row label="TIME ELAPSED" value={typeof timeElapsedS === "number" ? `${timeElapsedS.toFixed(1)}s` : "—"} />
        <Row label="VEHICLE SPEED" value={hasPose ? `${(pose.speed_mps * 3.6).toFixed(1)} km/h` : "—"} />
        <Row label="HEADING" value={hasPose ? `${pose.heading_deg.toFixed(1)}°` : "—"} />
        <Row label="POSITION" value={hasPose ? `${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}` : "—"} />
      </div>
    </Panel>
  );
}
