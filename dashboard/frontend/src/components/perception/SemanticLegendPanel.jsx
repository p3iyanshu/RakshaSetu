import { CLASS_COLOR } from "../../lib/colors.js";
import { RING_BOUNDARIES } from "../../lib/constants.js";
import Panel from "./Panel.jsx";

/** Small fixed compass rose -- the canvas never rotates the whole scene by
 * heading (README: an earlier attempt at that looked like the scene was
 * spinning), so this always just marks "FWD = up", not a live heading dial. */
function CompassRose() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0">
      <circle cx="22" cy="22" r="19" fill="none" stroke="var(--line-bright)" strokeWidth="1" />
      <line x1="22" y1="6" x2="22" y2="38" stroke="var(--line-bright)" strokeWidth="1" />
      <line x1="6" y1="22" x2="38" y2="22" stroke="var(--line-bright)" strokeWidth="1" />
      <path d="M22 5 L26 14 L22 11.5 L18 14 Z" fill="var(--signal)" />
      <text x="22" y="14" textAnchor="middle" fontSize="7" fill="var(--ink)" fontFamily="var(--font-mono)">F</text>
    </svg>
  );
}

/** Static meter scale bar illustrating the ring boundaries at a glance
 * (independent of the canvas's own live scale, which changes with its
 * container size). */
function ScaleBar() {
  const maxHi = RING_BOUNDARIES[RING_BOUNDARIES.length - 1].hi;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-[6px] w-full" style={{ background: "var(--line)" }}>
        {RING_BOUNDARIES.map((b) => (
          <div
            key={b.ring}
            className="absolute top-0 bottom-0"
            style={{ left: `${(b.lo / maxHi) * 100}%`, width: "1px", background: "var(--ink-faint)" }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[8.5px]" style={{ color: "var(--ink-faint)" }}>
        <span>0m</span>
        <span>{maxHi}m</span>
      </div>
    </div>
  );
}

/** SEMANTIC LEGEND -- exactly the 6 real classes from colors.js's
 * CLASS_COLOR, nothing renamed or added, plus a compass rose and scale bar. */
export default function SemanticLegendPanel() {
  return (
    <Panel title="Semantic Legend">
      <div className="flex flex-col gap-1 mb-3">
        {Object.entries(CLASS_COLOR).map(([cls, c]) => (
          <div key={cls} className="flex items-center gap-2 font-mono text-[10.5px]" style={{ color: "var(--ink)" }}>
            <i className="inline-block h-[8px] w-[8px] rounded-full shrink-0" style={{ backgroundColor: c.base }} />
            {c.label}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <CompassRose />
        <div className="flex-1">
          <ScaleBar />
        </div>
      </div>
    </Panel>
  );
}
