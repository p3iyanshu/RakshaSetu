import { useEffect, useState } from "react";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Live Perception's own header bar (in addition to the shared TopNav above
 * it) -- this view is the judge-facing demo screen, so it carries a full
 * brand + status strip on its own, matching the reference layout: brand
 * mark + title/subtitle on the left, the "Live Perception" pill centered,
 * mode/online/clock on the right.
 */
export default function HeaderBar({ modeLabel, online }) {
  const now = useClock();
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2.5 border-b flex-wrap"
      style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.85)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="cut-sm w-[30px] h-[30px] flex items-center justify-center font-display font-bold text-[12px] shrink-0"
          style={{ color: "var(--ground)", background: "linear-gradient(135deg, var(--signal), #1f8fa8)", boxShadow: "0 0 14px var(--signal-glow)" }}
        >
          RS
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-[13.5px] tracking-[0.06em] leading-tight" style={{ color: "var(--ink)" }}>
            RAKSHASETU
          </div>
          <div className="font-mono text-[9px] uppercase tracking-wide truncate" style={{ color: "var(--ink-faint)" }}>
            Adaptive 2.5D LiDAR Perception &middot; SIH PS 26053 &middot; DRDO
          </div>
        </div>
      </div>

      <span
        className="inline-flex items-center gap-2 font-display text-[11px] font-semibold tracking-[0.08em] uppercase px-4 py-1.5 border shrink-0"
        style={{ color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)", boxShadow: "0 0 14px var(--signal-glow)" }}
      >
        Live Perception
      </span>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className="font-mono text-[10px] uppercase tracking-wide px-2.5 py-1 border"
          style={{ color: "var(--ink-dim)", borderColor: "var(--line)", background: "var(--surface)" }}
        >
          Mode&nbsp; {modeLabel}
        </span>
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide px-2.5 py-1 border"
          style={
            online
              ? { color: "var(--safe)", borderColor: "var(--safe)", backgroundColor: "var(--safe-soft)" }
              : { color: "var(--amber)", borderColor: "var(--amber)", backgroundColor: "var(--amber-soft)" }
          }
        >
          <span className={`h-[6px] w-[6px] rounded-full ${online ? "pulse-dot" : ""}`} style={{ backgroundColor: online ? "var(--safe)" : "var(--amber)" }} />
          {online ? "System Online" : "Connecting"}
        </span>
        <span className="font-mono text-[12px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
          {now.toLocaleTimeString("en-GB", { hour12: false })}
        </span>
      </div>
    </div>
  );
}
