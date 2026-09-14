import { RING_BOUNDARIES } from "../../lib/constants.js";

/** The real adaptive-resolution bands as a small reference table -- the
 * map itself is what's supposed to demonstrate the concept; this is
 * supporting information, not a feature panel. Values come from
 * constants.js (the same source every renderer uses), never hardcoded
 * here. */
export default function ResolutionIndicator() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
        Adaptive grid
      </span>
      <table className="font-mono text-[10.5px] w-full" style={{ color: "var(--ink-dim)" }}>
        <thead>
          <tr style={{ color: "var(--ink-faint)" }}>
            <th className="text-left font-normal pb-1">Range</th>
            <th className="text-right font-normal pb-1">Cell size</th>
          </tr>
        </thead>
        <tbody>
          {RING_BOUNDARIES.map((band) => (
            <tr key={band.ring}>
              <td className="py-0.5">
                {band.lo}–{band.hi}m
              </td>
              <td className="py-0.5 text-right" style={{ color: "var(--ink)" }}>
                {Math.round(band.cellSize * 100)}cm
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
