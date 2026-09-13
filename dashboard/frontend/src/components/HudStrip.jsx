export default function HudStrip({ fps, latency, occupiedCells }) {
  return (
    <div className="flex items-center gap-7 font-mono text-[11px] tracking-wide text-[var(--ink-dim)] uppercase bg-[rgba(10,18,19,0.85)] border border-[var(--line)] backdrop-blur px-7 py-3.5 cut">
      <Reading value={fps} suffix="fps" label="FPS" />
      <Divider />
      <Reading value={latency} suffix="ms" label="Latency" decimals={0} />
      <Divider />
      <Reading value={occupiedCells} suffix="" label="Cells" decimals={0} />
    </div>
  );
}

function Divider() {
  return <div className="h-6 w-px bg-[var(--line-bright)]" />;
}

function Reading({ value, suffix, label, decimals = 0 }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-[var(--ink-faint)]">{label}</span>
      <span className="flex items-baseline gap-1 font-display font-semibold text-[var(--ink)] normal-case">
        <span className="text-xl tabular-nums">{typeof value === "number" ? value.toFixed(decimals) : "--"}</span>
        {suffix ? <span className="text-[10px] font-mono text-[var(--ink-dim)]">{suffix}</span> : null}
      </span>
    </div>
  );
}
