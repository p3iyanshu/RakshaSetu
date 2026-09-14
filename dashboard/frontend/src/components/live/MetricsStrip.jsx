/**
 * The six bottom-bar metrics from the brief, in order: FPS / LATENCY / mIoU
 * / GRID CELLS / COMPUTE SAVINGS / MEMORY USAGE. All real: FPS/latency/mIoU/
 * compute-savings/memory read directly from frame.metrics, the same
 * WebSocket payload every other view uses; CELLS is the live occupied-cell
 * count off frame.grid, same pattern TopDownLidarView already uses. Vehicle
 * speed lives in Scene Info instead (it's ego state, not a pipeline
 * metric). Nothing here is invented, and no tile gets added without a
 * schema field to back it.
 */
export default function MetricsStrip({ metrics, gridCells }) {
  const tiles = [
    { label: "FPS", value: metrics ? metrics.fps?.toFixed(1) : "—", unit: "" },
    { label: "LATENCY", value: metrics ? Math.round(metrics.latency_ms) : "—", unit: "ms" },
    { label: "mIoU", value: metrics ? (metrics.miou * 100).toFixed(1) : "—", unit: "%" },
    { label: "GRID CELLS", value: gridCells ?? "—", unit: "" },
    { label: "COMPUTE SAVINGS", value: metrics ? metrics.compute_savings_pct?.toFixed(1) : "—", unit: "%" },
    { label: "MEMORY USAGE", value: metrics?.memory_mb != null ? Math.round(metrics.memory_mb) : "—", unit: "MB" },
  ];

  return (
    <div className="flex items-stretch divide-x font-mono text-[11px]" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
      {tiles.map((t) => (
        <div key={t.label} className="px-3 py-1.5 flex items-baseline gap-1.5" style={{ borderColor: "var(--line)" }}>
          <span style={{ color: "var(--ink-dim)" }}>{t.label}</span>
          <span className="font-display font-semibold">
            {t.value}
            <span style={{ color: "var(--ink-dim)", fontSize: 9, marginLeft: 2 }}>{t.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
