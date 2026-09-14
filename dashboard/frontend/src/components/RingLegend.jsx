import { RING_BOUNDARIES } from "../lib/constants.js";

/** Spells out the adaptive-resolution story in numbers: each ring really is
 * a different cell size, not just a different color band. */
export default function RingLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--ink-faint)] tracking-wide">
      {RING_BOUNDARIES.map((b) => (
        <span key={b.ring}>
          <span className="text-[var(--signal)]">R{b.ring}</span> {b.lo}–{b.hi}m &middot; {Math.round(b.cellSize * 100)}cm cells
        </span>
      ))}
    </div>
  );
}
