import { useOutletContext } from "react-router-dom";
import { useContainerSize } from "../hooks/useContainerSize.js";
import PolarGrid from "../components/PolarGrid.jsx";
import StatTile from "../components/StatTile.jsx";
import Gauge from "../components/Gauge.jsx";
import ObjectsTable from "../components/ObjectsTable.jsx";
import ClassLegend from "../components/ClassLegend.jsx";
import RingLegend from "../components/RingLegend.jsx";
import AdminControls from "../components/AdminControls.jsx";

/**
 * Mission Ops section -- what a reviewer or fleet operator monitors: the
 * same live grid plus metrics trends, connection/model provenance, and the
 * full tracked-object table. Denser and more information-rich than the
 * car HUD by design. Lives inside the DashboardLayout shell, which owns the
 * live-feed connection and passes it down via Outlet context.
 */
export default function AdminView() {
  const { meta, frame, metricsHistory, trails } = useOutletContext();
  const [gridContainerRef, gridSize] = useContainerSize();
  const gridPx = Math.max(200, Math.min(gridSize.width, gridSize.height) - 8);
  const m = frame?.metrics;
  const isReal = meta?.mode === "real";

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto" style={{ background: "var(--ground)" }}>
      <div className="px-7 py-3 border-b flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px]" style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}>
        <span>
          SOURCE <span className="text-[var(--ink)]">{meta?.source ?? "—"}</span>
        </span>
        <span>
          CHECKPOINT <span className="text-[var(--ink)]">{meta?.checkpoint ?? "—"}</span>
        </span>
        <span
          className="px-2 py-0.5 font-display font-semibold text-[10px] uppercase tracking-wide"
          style={isReal ? { color: "var(--safe)", backgroundColor: "var(--safe-soft)" } : { color: "var(--amber)", backgroundColor: "var(--amber-soft)" }}
        >
          {isReal ? "Live model feed" : "Synthetic demo feed"}
        </span>
      </div>

      <main className="p-7 flex flex-col gap-6">
        <section className="cut border p-5" style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}>
          <div className="flex items-center justify-between mb-4 pb-2.5 border-b" style={{ borderColor: "var(--line)" }}>
            <span className="font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[var(--ink)]">System vitals</span>
            <span className="font-mono text-[10.5px] text-[var(--signal)]">LIVE</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 items-center">
            <Gauge label="Frame rate" value={m?.fps} max={15} unit="fps" color="var(--signal)" precision={1} />
            <Gauge label="Latency" value={m?.latency_ms} max={500} unit="ms" color="var(--amber)" precision={0} />
            <StatTile
              label="Segmentation mIoU"
              value={m ? m.miou * 100 : null}
              unit="%"
              history={metricsHistory.miou.map((v) => v * 100)}
              color="var(--safe)"
              precision={1}
            />
            <StatTile
              label="Compute savings"
              value={m?.compute_savings_pct}
              unit="%"
              history={metricsHistory.compute_savings_pct}
              color="var(--safe)"
              precision={1}
            />
          </div>
        </section>

        <AdminControls />

        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,460px)_1fr] gap-6 items-start">
          <div className="cut border p-4 flex flex-col gap-3" style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}>
            <div className="flex items-center justify-between gap-3 pb-2.5 border-b" style={{ borderColor: "var(--line)" }}>
              <span className="font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[var(--ink)]">Adaptive grid &mdash; live</span>
              <span
                className="px-2 py-0.5 font-mono text-[10.5px] font-medium"
                style={{ color: "var(--safe)", backgroundColor: "var(--safe-soft)" }}
              >
                &minus;{m ? m.compute_savings_pct.toFixed(1) : "—"}% COMPUTE
              </span>
            </div>
            <ClassLegend />
            <div ref={gridContainerRef} className="aspect-square w-full flex items-center justify-center">
              <PolarGrid cells={frame?.grid} objects={frame?.objects || []} trails={trails} size={gridPx} showLabels background="#0a1213" />
            </div>
            <RingLegend />
          </div>

          <div className="cut border p-4 flex flex-col gap-3 min-h-0" style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}>
            <div className="flex items-center justify-between pb-2.5 border-b" style={{ borderColor: "var(--line)" }}>
              <span className="font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[var(--ink)]">Tracked objects</span>
              <span className="font-mono text-[10.5px] text-[var(--ink-dim)]">{frame?.objects?.length ?? 0} active tracks</span>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              <ObjectsTable objects={frame?.objects} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
