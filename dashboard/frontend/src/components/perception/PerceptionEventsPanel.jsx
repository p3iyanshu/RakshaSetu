import { CLASS_COLOR } from "../../lib/colors.js";
import Panel from "./Panel.jsx";

/**
 * PERCEPTION EVENTS -- a timestamped feed, each entry colored by the class
 * it concerns. Phase 2: static placeholder rows just to verify layout; Phase
 * 4 wires this to real state-transition events (new track_id, is_dynamic
 * flip, a real heading-change event) -- never a bare timer.
 */
export default function PerceptionEventsPanel({ events = [] }) {
  return (
    <Panel title="Perception Events">
      <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
        {events.length === 0 && (
          <span className="font-mono text-[10px]" style={{ color: "var(--ink-faint)" }}>No events yet.</span>
        )}
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-2 font-mono text-[10px]" style={{ color: "var(--ink-dim)" }}>
            <i
              className="inline-block h-[7px] w-[7px] rounded-full shrink-0 mt-[3px]"
              style={{ backgroundColor: ev.cls != null ? (CLASS_COLOR[ev.cls] ?? CLASS_COLOR[5]).base : "var(--signal)" }}
            />
            <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-faint)" }}>{ev.time}</span>
            <span style={{ color: "var(--ink)" }}>{ev.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
