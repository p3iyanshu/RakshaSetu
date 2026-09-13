import Sparkline from "./Sparkline.jsx";

export default function StatTile({ label, value, unit, history, color = "var(--signal)", precision = 0 }) {
  const display = typeof value === "number" && !Number.isNaN(value) ? value.toFixed(precision) : "--";
  return (
    <div className="cut border p-4 flex flex-col gap-2 min-w-0" style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}>
      <div className="font-display text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--ink-dim)]">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-display text-[26px] font-bold text-[var(--ink)] tabular-nums">
          {display}
          {unit ? <span className="text-[12px] font-mono font-normal text-[var(--ink-dim)] ml-1">{unit}</span> : null}
        </div>
        {history && history.length > 1 ? <Sparkline data={history} color={color} /> : null}
      </div>
    </div>
  );
}
