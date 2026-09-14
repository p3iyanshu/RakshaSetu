import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useContainerSize } from "../../hooks/useContainerSize.js";
import { useInterpolatedScene } from "../../lib/live/interpolate.js";
import {
  rotateByHeading,
  toIsoScreen,
  forwardEnvelopeAlpha,
  screenToEgoRelative,
} from "../../lib/live/coordinateTransform.js";
import { getEgoPose } from "../../lib/live/scenario.js";
import { MAX_RANGE_M, RING_BOUNDARIES } from "../../lib/constants.js";
import RoadEnvironment from "./RoadEnvironment.jsx";
import AdaptiveGridLayer from "./AdaptiveGridLayer.jsx";
import TrackTrail from "./TrackTrail.jsx";
import VehicleMarker from "./VehicleMarker.jsx";
import DetectionLabel from "./DetectionLabel.jsx";
import MetricsStrip from "./MetricsStrip.jsx";
import EventFeed from "./EventFeed.jsx";
import ResolutionIndicator from "./ResolutionIndicator.jsx";
import SemanticLegend from "./SemanticLegend.jsx";
import ElevationPanel from "./ElevationPanel.jsx";
import SelectedObjectPanel from "./SelectedObjectPanel.jsx";
import SceneInfoPanel from "./SceneInfoPanel.jsx";
import DemoControls from "./DemoControls.jsx";

const HEIGHT_SCALE_PX_PER_M = 22;
const NEARBY_RANGE_M = 20; // static objects closer than this still get a full card
const CARD_W = 78;
const CARD_H = 52;
const MAX_FULL_CARDS = 6;

/**
 * The one primary "LIVE PERCEPTION" screen: a road-centric 2.5D scene, not
 * a radar. Three-column layout -- scene info / adaptive grid / elevation on
 * the left, the map dominating the center, events / selected-object on the
 * right -- with the map itself doing the real demonstrating. The vehicle is
 * driven along a scripted road (scenario.js): position AND heading,
 * including an actual right turn at an intersection, while the real
 * grid/object/metrics data from the shared live feed is rotated (never
 * re-derived) to match -- the backend never changes. Lives inside the
 * DashboardLayout shell, which owns the live-feed connection and passes it
 * down via Outlet context.
 */
export default function PerceptionScene() {
  const { frame, trails, meta } = useOutletContext();
  const { cells, objects, events, pushEvent } = useInterpolatedScene(frame);
  const [containerRef, size] = useContainerSize();

  const wasTurningRef = useRef(false);
  const [, forceTick] = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [selectedCellKey, setSelectedCellKey] = useState(null);

  // Play/pause/speed -- pausing freezes the scripted clock; speed scales it.
  const [playing, setPlaying] = useState(true);
  const clockRef = useRef({ accumulatedMs: 0, lastRealMs: performance.now(), speedMul: 1 });

  // Drive the scripted clock every animation frame (piggybacking on
  // useInterpolatedScene's own rAF-driven re-renders is not guaranteed to
  // run when the feed is idle, so this view keeps a small rAF of its own).
  useEffect(() => {
    let raf;
    function tick(now) {
      const clock = clockRef.current;
      const realDt = now - clock.lastRealMs;
      clock.lastRealMs = now;
      if (playing) clock.accumulatedMs += realDt * clock.speedMul;
      forceTick((v) => (v + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const pose = getEgoPose(clockRef.current.accumulatedMs);
  if (pose.phase === "turning right" && !wasTurningRef.current) {
    wasTurningRef.current = true;
    pushEvent("APPROACHING INTERSECTION — TURN STARTED", "turn");
  } else if (pose.phase !== "turning right" && wasTurningRef.current) {
    wasTurningRef.current = false;
    pushEvent("TURN COMPLETE — ON NEW ROAD", "turn");
  }

  const width = size.width || 1;
  const height = size.height || 1;
  const originX = width / 2;
  const originY = height * 0.62; // vehicle sits lower-center, more road visible ahead
  const margin = 24;
  const scale = (Math.min(width, height * 1.3) / 2 - margin) / MAX_RANGE_M; // px per meter, ground plane

  const latestMetrics = frame?.metrics;
  const gridCellCount = frame?.grid ? frame.grid.filter((c) => c.point_count > 0).length : 0;
  const selectedObj = objects.find((o) => o.trackId === selectedTrackId) || null;
  const selectedCell = cells.find((c) => `${c.ring}_${c.angular_bin}` === selectedCellKey) || null;

  function handleMapClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - originX;
    const dy = e.clientY - rect.top - originY;
    const { forward, right } = screenToEgoRelative(dx, dy, scale, pose.headingDeg);
    const rangeM = Math.hypot(forward, right);
    const bearingDeg = (Math.atan2(right, forward) * 180) / Math.PI;
    const ringIdx = RING_BOUNDARIES.findIndex((b) => rangeM >= b.lo && rangeM < b.hi);
    if (ringIdx === -1) {
      setSelectedCellKey(null);
      return;
    }
    const angularBin = Math.floor((((bearingDeg % 360) + 360) % 360) / 10);
    const hit = cells.find((c) => c.ring === ringIdx && c.angular_bin === angularBin);
    setSelectedCellKey(hit ? `${ringIdx}_${angularBin}` : null);
    setSelectedTrackId(null);
  }

  // Greedy label declutter: dynamic + nearby objects want a full card, but
  // 1) objects well outside the forward envelope never get one (they're
  //    barely visible on the grid at that point anyway), 2) a hard cap
  //    bounds how many cards can ever be on screen at once regardless of
  //    how many the real feed flags dynamic in a given frame, and 3) the
  //    collision check uses each card's actual rendered footprint (it
  //    extends upward from its anchor, not centered on it), not just
  //    anchor-to-anchor distance. The selected object always keeps its card.
  const placedBoxes = [];
  let fullCardCount = 0;
  const labeledObjects = [...objects]
    .sort((a, b) => {
      if (a.trackId === selectedTrackId) return -1;
      if (b.trackId === selectedTrackId) return 1;
      if (a.isDynamic !== b.isDynamic) return a.isDynamic ? -1 : 1;
      return Math.hypot(a.forward, a.right) - Math.hypot(b.forward, b.right);
    })
    .map((obj) => {
      // The real feed has no concept of the scripted turn -- its data is
      // ego-relative to whatever the backend calls "forward", which never
      // itself rotates. Applying the scripted heading here is what makes
      // the real grid/objects visually turn together with the road.
      const rotated = rotateByHeading(obj.forward, obj.right, pose.headingDeg);
      const bearingDeg = (Math.atan2(rotated.right, rotated.forward) * 180) / Math.PI;
      const s = toIsoScreen(rotated.forward, rotated.right, 0.4, scale, HEIGHT_SCALE_PX_PER_M);
      const sx = originX + s.x;
      const sy = originY + s.y;
      const rangeM = Math.hypot(obj.forward, obj.right);
      const inEnvelope = forwardEnvelopeAlpha(bearingDeg) > 0.15;
      const isSelected = obj.trackId === selectedTrackId;

      let compact = (!inEnvelope || fullCardCount >= MAX_FULL_CARDS || (!obj.isDynamic && rangeM > NEARBY_RANGE_M)) && !isSelected;
      if (!compact) {
        const box = { left: sx - CARD_W / 2, right: sx + CARD_W / 2, top: sy - CARD_H, bottom: sy };
        const collides = placedBoxes.some(
          (b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top
        );
        if (collides && !isSelected) compact = true;
        else {
          placedBoxes.push(box);
          fullCardCount += 1;
        }
      }
      return { obj, sx, sy, compact, isSelected, rangeM };
    });

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden" style={{ background: "var(--ground)" }}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b flex-wrap gap-2"
        style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.7)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
          Adaptive 2.5D LiDAR Perception &middot; SIH PS 26053 &middot; DRDO
        </span>
        <span
          className="inline-flex items-center gap-2 font-display text-[11px] font-semibold tracking-[0.08em] uppercase px-3 py-1 border"
          style={{ color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)", boxShadow: "0 0 14px var(--signal-glow)" }}
        >
          Live Perception
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-wide px-2.5 py-1 border"
          style={{ color: "var(--ink-dim)", borderColor: "var(--line)", background: "var(--surface)" }}
        >
          Mode {meta?.mode === "real" ? "Recorded (SemanticKITTI)" : meta?.mode === "mock" ? "Simulation" : "—"}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside
          className="w-[190px] shrink-0 border-r overflow-y-auto p-3 flex flex-col gap-5"
          style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.55)" }}
        >
          <SceneInfoPanel pose={pose} />
          <ResolutionIndicator />
          <SemanticLegend />
        </aside>

        <div
          ref={containerRef}
          className="relative flex-1 min-h-0"
          style={{ opacity: pose.fade }}
          onClick={handleMapClick}
        >
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-10 font-mono text-[10px] uppercase tracking-wide px-3 py-1 border"
            style={{ color: "var(--ink-dim)", borderColor: "var(--line)", background: "rgba(10,17,16,0.75)" }}
          >
            {pose.phase}
          </div>

          {width > 1 && (
            <>
              <RoadEnvironment
                egoX={pose.x}
                egoY={pose.y}
                egoHeadingDeg={pose.headingDeg}
                scale={scale}
                heightScale={HEIGHT_SCALE_PX_PER_M}
                originX={originX}
                originY={originY}
                width={width}
                height={height}
                fade={1}
              />
              <AdaptiveGridLayer
                cells={cells}
                headingDeg={pose.headingDeg}
                scale={scale}
                heightScale={HEIGHT_SCALE_PX_PER_M}
                originX={originX}
                originY={originY}
                width={width}
                height={height}
                selectedCellKey={selectedCellKey}
              />
              <TrackTrail
                objects={objects}
                trails={trails}
                headingDeg={pose.headingDeg}
                scale={scale}
                heightScale={HEIGHT_SCALE_PX_PER_M}
                originX={originX}
                originY={originY}
                width={width}
                height={height}
              />
              {labeledObjects.map(({ obj, sx, sy, compact, isSelected, rangeM }) => (
                <DetectionLabel
                  key={obj.trackId}
                  x={sx}
                  y={sy}
                  cls={obj.cls}
                  trackId={obj.trackId}
                  confidence={obj.confidence}
                  isDynamic={obj.isDynamic}
                  velocity={obj.velocity}
                  rangeM={rangeM}
                  alpha={obj.alpha}
                  scanIn={obj.scanIn ?? 1}
                  compact={compact}
                  selected={isSelected}
                  onSelect={(id) => {
                    setSelectedTrackId(id);
                    setSelectedCellKey(null);
                  }}
                />
              ))}
              <VehicleMarker x={originX} y={originY} headingDeg={pose.headingDeg} />
            </>
          )}
        </div>

        <aside
          className="w-[220px] shrink-0 border-l overflow-y-auto p-3 flex flex-col gap-5"
          style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.55)" }}
        >
          <EventFeed events={events} />
          <SelectedObjectPanel obj={selectedObj} />
          <ElevationPanel cell={selectedCell} />
        </aside>
      </div>

      <div
        className="border-t flex items-center justify-between flex-wrap gap-2"
        style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.9)" }}
      >
        <MetricsStrip metrics={latestMetrics} gridCells={gridCellCount} />
        <div className="pr-3">
          <DemoControls
            playing={playing}
            speedMul={clockRef.current.speedMul}
            onTogglePlay={() => setPlaying((p) => !p)}
            onRestart={() => {
              clockRef.current.accumulatedMs = 0;
            }}
            onSetSpeed={(s) => {
              clockRef.current.speedMul = s;
              forceTick((v) => (v + 1) % 1_000_000);
            }}
          />
        </div>
      </div>
    </div>
  );
}
