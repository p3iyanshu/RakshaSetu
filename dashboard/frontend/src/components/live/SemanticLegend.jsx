import { CLASS_COLOR } from "../../lib/colors.js";

/** The same class colors the map itself uses (CLASS_COLOR, nowhere else) --
 * a compact reference list, not a feature panel -- plus a static compass
 * rose and a meter scale bar underneath, purely orientation reference (the
 * map itself never rotates the compass; heading is read from Scene Info). */
export default function SemanticLegend() {
  const entries = Object.entries(CLASS_COLOR);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
          Semantic classes
        </span>
        {entries.map(([cls, info]) => (
          <div key={cls} className="flex items-center gap-2 font-mono text-[10.5px]" style={{ color: "var(--ink-dim)" }}>
            <span className="h-[7px] w-[7px] rounded-full shrink-0" style={{ background: info.base }} />
            {info.label}
          </div>
        ))}
      </div>
      <CompassRose />
      <ScaleBar />
    </div>
  );
}

function CompassRose() {
  return (
    <div className="flex items-center gap-2">
      <svg width="40" height="40" viewBox="-20 -20 40 40">
        <circle cx="0" cy="0" r="17" fill="none" stroke="var(--line)" strokeWidth="1" />
        <line x1="0" y1="-17" x2="0" y2="17" stroke="var(--line)" strokeWidth="1" />
        <line x1="-17" y1="0" x2="17" y2="0" stroke="var(--line)" strokeWidth="1" />
        <polygon points="0,-15 3,-6 -3,-6" fill="var(--signal)" />
        <text x="0" y="-19" textAnchor="middle" fontSize="8" fill="var(--ink)" fontFamily="monospace">N</text>
        <text x="21" y="3" textAnchor="middle" fontSize="7.5" fill="var(--ink-faint)" fontFamily="monospace">E</text>
        <text x="0" y="26" textAnchor="middle" fontSize="7.5" fill="var(--ink-faint)" fontFamily="monospace">S</text>
        <text x="-21" y="3" textAnchor="middle" fontSize="7.5" fill="var(--ink-faint)" fontFamily="monospace">W</text>
      </svg>
      <span className="font-mono text-[9px] leading-tight" style={{ color: "var(--ink-faint)" }}>
        Heading reference
        <br />0° = north at scenario start
      </span>
    </div>
  );
}

function ScaleBar() {
  const marks = [0, 10, 20, 30];
  const pxPerM = 3.2;
  return (
    <div className="flex flex-col gap-1">
      <svg width={marks[marks.length - 1] * pxPerM + 4} height="16">
        <line x1="2" y1="4" x2={marks[marks.length - 1] * pxPerM + 2} y2="4" stroke="var(--ink-dim)" strokeWidth="1" />
        {marks.map((m) => (
          <line key={m} x1={m * pxPerM + 2} y1="1" x2={m * pxPerM + 2} y2="7" stroke="var(--ink-dim)" strokeWidth="1" />
        ))}
        {marks.map((m) => (
          <text key={m} x={m * pxPerM + 2} y="15" textAnchor="middle" fontSize="7.5" fill="var(--ink-faint)" fontFamily="monospace">
            {m}
          </text>
        ))}
      </svg>
      <span className="font-mono text-[9px]" style={{ color: "var(--ink-faint)" }}>
        Scale (m), ground plane
      </span>
    </div>
  );
}
