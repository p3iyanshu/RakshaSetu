import Panel from "./Panel.jsx";

const GRADIENT_LO = "#173a2e"; // low height
const GRADIENT_HI = "#e2a23b"; // tall (wall/pole scale)

/**
 * ELEVATION (2.5D) -- the selected cell's real height_max/height_mean, the
 * actual "2.5D" fields every existing renderer reads but never displays.
 * Phase 4 uses these same two numbers to drive the canvas's vertical
 * extrusion; this panel just shows the raw values plus a static legend
 * mapping height to the gradient used there.
 */
export default function ElevationPanel({ cell }) {
  return (
    <Panel title="Elevation (2.5D)">
      <div className="flex flex-col gap-1.5 mb-3 font-mono text-[10.5px]">
        <div className="flex items-baseline justify-between gap-2">
          <span style={{ color: "var(--ink-faint)" }}>HEIGHT MAX</span>
          <span className="tabular-nums" style={{ color: "var(--ink)" }}>
            {cell ? `${cell.height_max.toFixed(2)} m` : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span style={{ color: "var(--ink-faint)" }}>HEIGHT MEAN</span>
          <span className="tabular-nums" style={{ color: "var(--ink)" }}>
            {cell ? `${cell.height_mean.toFixed(2)} m` : "—"}
          </span>
        </div>
      </div>
      <div className="h-[8px] w-full rounded-sm" style={{ background: `linear-gradient(90deg, ${GRADIENT_LO}, ${GRADIENT_HI})` }} />
      <div className="flex justify-between font-mono text-[8.5px] mt-1" style={{ color: "var(--ink-faint)" }}>
        <span>0m</span>
        <span>3m+</span>
      </div>
    </Panel>
  );
}
