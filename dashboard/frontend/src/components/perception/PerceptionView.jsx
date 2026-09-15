import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useContainerSize } from "../../hooks/useContainerSize.js";
import { usePerceptionAnimation } from "../../hooks/usePerceptionAnimation.js";
import { MAX_RANGE_M } from "../../lib/constants.js";
import { makeFanLayout } from "../../lib/perception/fanProjection.js";
import HeaderBar from "./HeaderBar.jsx";
import SceneInfoPanel from "./SceneInfoPanel.jsx";
import AdaptiveGridPanel from "./AdaptiveGridPanel.jsx";
import SemanticLegendPanel from "./SemanticLegendPanel.jsx";
import FanCanvas from "./FanCanvas.jsx";
import DetectionCards from "./DetectionCards.jsx";
import PerceptionEventsPanel from "./PerceptionEventsPanel.jsx";
import SelectedObjectPanel from "./SelectedObjectPanel.jsx";
import ElevationPanel from "./ElevationPanel.jsx";
import BottomBar from "./BottomBar.jsx";

const MODE_LABEL = { real: "Recorded (SemanticKITTI)", mock: "Simulation" };

/**
 * Wired to the real live feed via DashboardLayout's shared useLiveFeed
 * connection (Outlet context) -- no second WebSocket client. Motion/depth
 * polish (world-buffer persistence, height extrusion, interpolation,
 * scan-sweep, detection callouts, real event feed) lives in
 * usePerceptionAnimation + FanCanvas; this component wires real frame data
 * into both and assembles the fixed 3-column layout.
 */
export default function PerceptionView() {
  const { frame, meta, trails, status } = useOutletContext();
  const [canvasRef, canvasSize] = useContainerSize();
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [selectedCellKey, setSelectedCellKey] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  // Pausing freezes what this view renders -- the backend's own stream (and
  // useLiveFeed's connection) keeps running regardless; "speed" similarly
  // only affects local playback smoothing, not the server's real cadence.
  const [displayFrame, setDisplayFrame] = useState(frame);
  useEffect(() => {
    if (playing) setDisplayFrame(frame);
  }, [frame, playing]);

  const { egoPose, bufferedCells, objects, events, reset } = usePerceptionAnimation(displayFrame);

  const layout = useMemo(
    () => (canvasSize.width > 1 && canvasSize.height > 1 ? makeFanLayout(canvasSize.width, canvasSize.height, MAX_RANGE_M) : null),
    [canvasSize.width, canvasSize.height]
  );

  const grid = displayFrame?.grid ?? [];
  // Real occupied-cell count, never a raw point count -- expect a small
  // double-digit number (README baseline: dozens of the 144 cells occupied).
  const gridCells = grid.filter((c) => c.point_count > 0).length;
  const selectedObj = objects.find((o) => o.track_id === selectedTrackId) || null;
  const selectedCell = grid.find((c) => `${c.ring}_${c.angular_bin}` === selectedCellKey) || null;

  // Headline accuracy is the checkpoint's real held-out validation mIoU, not
  // this window's live per-frame mIoU (build_demo_data.py's own note: live
  // per-frame mIoU runs lower here because inference-time downsampling has
  // no ground truth to do class-aware sampling with, unlike training's
  // validation pass) -- surfacing the live number as "the model's accuracy"
  // would understate it.
  const headlineMiou = typeof meta?.checkpoint_val_miou === "number" ? meta.checkpoint_val_miou : displayFrame?.metrics?.miou;
  const bottomMetrics = displayFrame?.metrics ? { ...displayFrame.metrics, miou: headlineMiou } : null;

  function handleSelectCell(key) {
    setSelectedCellKey(key);
    setSelectedTrackId(null);
  }
  function handleSelectObject(id) {
    setSelectedTrackId(id);
    setSelectedCellKey(null);
  }
  function handleRestart() {
    setSelectedTrackId(null);
    setSelectedCellKey(null);
    reset();
  }

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <HeaderBar modeLabel={MODE_LABEL[meta?.mode] ?? "—"} online={status === "open"} />

      <div className="flex-1 min-h-0 flex">
        <aside
          className="w-[210px] shrink-0 border-r overflow-y-auto p-3 flex flex-col gap-4"
          style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.55)" }}
        >
          <SceneInfoPanel scenario={meta?.source ?? "—"} timeElapsedS={displayFrame?.timestamp} pose={egoPose} />
          <AdaptiveGridPanel />
          <SemanticLegendPanel />
        </aside>

        <div ref={canvasRef} className="relative flex-1 min-h-0">
          {layout && (
            <>
              <FanCanvas
                cells={grid}
                objects={objects}
                bufferedCells={bufferedCells}
                trails={trails}
                width={canvasSize.width}
                height={canvasSize.height}
                layout={layout}
                nowMs={performance.now()}
                selectedCellKey={selectedCellKey}
                selectedTrackId={selectedTrackId}
                onSelectCell={handleSelectCell}
                onSelectObject={handleSelectObject}
              />
              <DetectionCards objects={objects} layout={layout} selectedTrackId={selectedTrackId} onSelect={handleSelectObject} />
            </>
          )}
          {!displayFrame && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
              Connecting to live feed&hellip;
            </div>
          )}
        </div>

        <aside
          className="w-[230px] shrink-0 border-l overflow-y-auto p-3 flex flex-col gap-4"
          style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.55)" }}
        >
          <PerceptionEventsPanel events={events} />
          <SelectedObjectPanel obj={selectedObj} />
          <ElevationPanel cell={selectedCell} />
        </aside>
      </div>

      <BottomBar
        metrics={bottomMetrics}
        gridCells={displayFrame ? gridCells : null}
        memoryMb={displayFrame?.metrics?.memory_mb}
        playing={playing}
        speed={speed}
        onTogglePlay={() => setPlaying((p) => !p)}
        onRestart={handleRestart}
        onSetSpeed={setSpeed}
      />
    </div>
  );
}
