const SPEED_OPTIONS = [0.5, 1, 2, 4];

function Stat({ label, value, title }) {
  return (
    <div className="flex items-baseline gap-1.5 font-mono text-[10.5px]" title={title}>
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span className="tabular-nums font-semibold" style={{ color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

/**
 * Bottom metrics/controls strip. Every value here is a real field from
 * frame.metrics (or a real derived count/measurement) -- FPS/latency/mIoU
 * come straight off the payload, GRID CELLS is a count of occupied cells
 * (never a raw point count), COMPUTE SAVINGS is the analytically-derived
 * constant as-is, and MEMORY USAGE is real process RSS (Phase 3).
 */
export default function BottomBar({ metrics, gridCells, memoryMb, playing, speed, onTogglePlay, onRestart, onSetSpeed }) {
  const m = metrics || {};
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-x-6 gap-y-2 px-4 py-2 border-t"
      style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.9)" }}
    >
      <div className="flex items-center flex-wrap gap-x-5 gap-y-1.5">
        <Stat label="FPS" value={typeof m.fps === "number" ? m.fps.toFixed(1) : "—"} />
        <Stat label="LATENCY" value={typeof m.latency_ms === "number" ? `${m.latency_ms.toFixed(0)}ms` : "—"} />
        <Stat
          label="mIoU"
          value={typeof m.miou === "number" ? `${(m.miou * 100).toFixed(1)}%` : "—"}
          title="Checkpoint's held-out validation mIoU -- the model's real accuracy figure. Live per-frame mIoU on this demo clip runs lower due to inference-time downsampling, so it isn't shown here as 'the' accuracy."
        />
        <Stat label="GRID CELLS" value={gridCells ?? "—"} />
        <Stat label="COMPUTE SAVINGS" value={typeof m.compute_savings_pct === "number" ? `${m.compute_savings_pct.toFixed(1)}%` : "—"} />
        <Stat label="MEMORY" value={typeof memoryMb === "number" ? `${memoryMb.toFixed(0)} MB` : "—"} />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="font-display text-[10.5px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-colors"
          style={{ color: "var(--ink)", background: "var(--surface)", borderColor: "var(--line)" }}
        >
          {playing ? "Pause" : "Resume"}
        </button>
        <button
          onClick={onRestart}
          className="font-display text-[10.5px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-colors"
          style={{ color: "var(--ink)", background: "var(--surface)", borderColor: "var(--line)" }}
        >
          Restart
        </button>
        <select
          value={speed}
          onChange={(e) => onSetSpeed?.(Number(e.target.value))}
          className="font-mono text-[10.5px] px-2 py-1.5 border"
          style={{ color: "var(--ink)", background: "var(--surface)", borderColor: "var(--line)" }}
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}&times;</option>
          ))}
        </select>
      </div>
    </div>
  );
}
