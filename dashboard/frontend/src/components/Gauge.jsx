/** Semicircular progress gauge, matching the RakshaSetu Console reference's
 * system-health dials. `value`/`max` map to arc fill; `pathLength=100` lets
 * the dasharray/dashoffset math stay in percent regardless of arc length. */
export default function Gauge({ label, value, max, unit = "", precision = 0, color = "var(--signal)" }) {
  const pct = typeof value === "number" && max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const display = typeof value === "number" && !Number.isNaN(value) ? value.toFixed(precision) : "--";
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 58" className="w-full max-w-[150px]">
        <path d="M10,52 A40,40 0 0,1 90,52" pathLength="100" fill="none" stroke="var(--line)" strokeWidth="8" />
        <path
          d="M10,52 A40,40 0 0,1 90,52"
          pathLength="100"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100 - pct}
          style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: "stroke-dashoffset .5s ease" }}
        />
      </svg>
      <div className="-mt-7 flex flex-col items-center font-mono text-[10px] uppercase tracking-wide text-[var(--ink-dim)]">
        <span className="font-display text-xl font-semibold text-[var(--ink)] tabular-nums normal-case">
          {display}
          {unit ? <span className="text-[10px] font-mono text-[var(--ink-dim)] ml-0.5">{unit}</span> : null}
        </span>
        <span className="mt-0.5">{label}</span>
      </div>
    </div>
  );
}
