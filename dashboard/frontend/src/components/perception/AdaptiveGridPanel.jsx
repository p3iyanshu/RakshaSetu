import { RING_BOUNDARIES } from "../../lib/constants.js";
import Panel from "./Panel.jsx";

/**
 * ADAPTIVE GRID (FOVEATED) -- range vs. cell-size table generated directly
 * from RING_BOUNDARIES, the same single source of truth PolarGrid/RingLegend
 * already read from. Not hardcoded: if RING_BOUNDARIES ever changes, this
 * table changes with it.
 */
export default function AdaptiveGridPanel() {
  return (
    <Panel title="Adaptive Grid (Foveated)">
      <table className="w-full font-mono text-[10.5px] border-collapse">
        <thead>
          <tr style={{ color: "var(--ink-faint)" }}>
            <th className="text-left font-normal pb-1">RING</th>
            <th className="text-left font-normal pb-1">RANGE</th>
            <th className="text-right font-normal pb-1">CELL</th>
          </tr>
        </thead>
        <tbody>
          {RING_BOUNDARIES.map((b) => (
            <tr key={b.ring} className="border-t" style={{ borderColor: "var(--line)" }}>
              <td className="py-1" style={{ color: "var(--signal)" }}>R{b.ring}</td>
              <td className="py-1 tabular-nums" style={{ color: "var(--ink)" }}>{b.lo}&ndash;{b.hi}m</td>
              <td className="py-1 text-right tabular-nums" style={{ color: "var(--ink)" }}>{Math.round(b.cellSize * 100)}cm</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
