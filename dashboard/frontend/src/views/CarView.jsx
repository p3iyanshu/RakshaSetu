import { useLiveFeed } from "../hooks/useLiveFeed.js";
import { useContainerSize } from "../hooks/useContainerSize.js";
import WindshieldView, { nearestAheadHazard } from "../components/WindshieldView.jsx";
import HudStrip from "../components/HudStrip.jsx";
import ClassLegend from "../components/ClassLegend.jsx";
import Topbar from "../components/Topbar.jsx";
import { CLASS_COLOR } from "../lib/colors.js";

const HAZARD_ALERT_RANGE_M = 20;

/**
 * Onboard console / HUD -- a forward "windshield" view (matching the
 * RakshaSetu Console reference's instrument-cluster metaphor), not a
 * 360-degree radar sweep -- that's what a driver/operator actually sees
 * through the front glass. Every wedge and marker is still a real
 * projection of the live grid/object data; nothing here is simulated.
 */
export default function CarView() {
  const { status, frame, trails } = useLiveFeed();
  const [containerRef, size] = useContainerSize();
  const occupiedCells = frame?.grid ? frame.grid.filter((c) => c.point_count > 0).length : null;
  const nearest = frame?.objects ? nearestAheadHazard(frame.objects) : null;
  const showAlert = nearest && nearest.dist <= HAZARD_ALERT_RANGE_M;
  const alertColor = nearest ? (CLASS_COLOR[nearest.cls] || CLASS_COLOR[5]).base : "var(--amber)";
  const alertLabel = nearest ? (CLASS_COLOR[nearest.cls] || CLASS_COLOR[5]).label : "";

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <Topbar active="car" status={status} />

      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col items-center justify-center relative px-6 py-5 gap-4">
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 font-mono text-[11px] tracking-wide px-3.5 py-1.5 border transition-opacity duration-200"
          style={
            showAlert
              ? { color: alertColor, background: `${alertColor}22`, borderColor: `${alertColor}80`, opacity: 1 }
              : { color: "var(--safe)", background: "var(--safe-soft)", borderColor: "rgba(74,194,107,0.35)", opacity: 1 }
          }
        >
          <span className="h-[7px] w-[7px] rounded-full pulse-dot" style={{ backgroundColor: showAlert ? alertColor : "var(--safe)" }} />
          {showAlert ? `${alertLabel.toUpperCase()} — ${nearest.dist.toFixed(0)}M AHEAD` : "ADAPTIVE PERCEPTION ACTIVE"}
        </div>

        <div
          className="relative flex-1 min-h-0 w-full flex items-center justify-center border overflow-hidden"
          style={{ borderColor: "var(--line)", background: "#0a1213" }}
        >
          <WindshieldView
            cells={frame?.grid}
            objects={frame?.objects || []}
            trails={trails}
            width={Math.max(320, size.width - 4)}
            height={Math.max(240, size.height - 4)}
            background="#0a1213"
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <HudStrip fps={frame?.metrics?.fps} latency={frame?.metrics?.latency_ms} occupiedCells={occupiedCells} />
          <ClassLegend compact />
        </div>
      </div>
    </div>
  );
}
