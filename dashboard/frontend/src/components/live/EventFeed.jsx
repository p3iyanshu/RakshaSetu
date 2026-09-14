import { CLASS_COLOR } from "../../lib/colors.js";

/**
 * Real state-transition log only -- entries come from useInterpolatedScene
 * (a new track_id appearing, is_dynamic flipping) and the turn-sequence
 * transition PerceptionScene pushes when the scripted path enters/exits a
 * curve. Nothing here fires on a timer with no underlying event.
 *
 * Small, corner-anchored panel -- deliberately doesn't cover the map.
 */
export default function EventFeed({ events }) {
  return (
    <div
      className="cut border flex flex-col w-full max-h-[240px]"
      style={{ borderColor: "var(--line)", background: "rgba(10,18,19,0.88)" }}
    >
      <div
        className="px-3 py-1.5 border-b font-display text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ink)]"
        style={{ borderColor: "var(--line)" }}
      >
        Perception events
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {events.length === 0 && <span className="font-mono text-[10px] text-[var(--ink-faint)]">Waiting for events…</span>}
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <span
              className="h-[7px] w-[7px] rounded-full shrink-0 mt-[3px]"
              style={{ background: eventDotColor(e) }}
            />
            <div className="font-mono text-[10px] leading-tight">
              <div className="text-[var(--ink-faint)]">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</div>
              <div style={{ color: "var(--ink)" }}>{e.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function eventDotColor(e) {
  if (e.cls != null && CLASS_COLOR[e.cls]) return CLASS_COLOR[e.cls].base;
  if (e.kind === "turn") return "var(--amber)";
  return "var(--signal)";
}
