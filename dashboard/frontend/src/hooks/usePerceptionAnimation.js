import { useEffect, useRef, useState } from "react";
import { CLASS_COLOR } from "../lib/colors.js";
import { MAX_RANGE_M, RING_BOUNDARIES } from "../lib/constants.js";
import { createWorldBuffer, projectWorldBuffer, upsertStaticCells } from "../lib/perception/worldBuffer.js";

const NEW_TRACK_GLOW_MS = 1500;
const HEADING_EVENT_THRESHOLD_DEG = 15;
const MAX_EVENTS = 30;
const MIN_GAP_MS = 60;
const MAX_GAP_MS = 700;

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpAngleDeg(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * t;
}
function clockLabel() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}
function classLabel(cls) {
  return (CLASS_COLOR[cls] ?? CLASS_COLOR[5]).label;
}

/**
 * Real inference runs ~2-5.5fps (README) -- frames arrive as discrete jumps
 * every ~180-500ms. This hook smooths that for rendering (ego pose, the
 * world buffer's projection, tracked-object positions) via requestAnimationFrame
 * interpolation, WITHOUT touching useLiveFeed's own contract (CarView/AdminView
 * still get the raw wholesale-swap `frame`). It also derives Live Perception's
 * world-persistence buffer and its event feed from genuine state transitions
 * (new track_id, an is_dynamic flip, a real heading-change event) -- never a
 * bare timer. The displayed FPS stat stays the honest raw frame.metrics.fps;
 * nothing here touches that.
 */
export function usePerceptionAnimation(frame) {
  const worldBufferRef = useRef(createWorldBuffer());
  const prevFrameRef = useRef(null);
  const seenTracksRef = useRef(new Map()); // track_id -> { is_dynamic, firstSeenMs }
  const eventsRef = useRef([]);
  const lastHeadingEventDegRef = useRef(null);
  const transitionRef = useRef({ arrivedAt: performance.now(), prevEgo: null, currEgo: null, gapMs: 250 });
  const prevObjectsByIdRef = useRef(new Map());

  const [events, setEvents] = useState([]);
  const [tick, setTick] = useState(0); // bumped every animation frame to force a re-render

  // Runs once per NEW real frame: snapshot timing for interpolation, upsert
  // the world buffer with THIS frame's real cells/ego_pose (not an
  // interpolated pose -- the buffer's own transform must stay exact), and
  // detect real state transitions for the event feed.
  useEffect(() => {
    if (!frame) return;
    const now = performance.now();
    const prev = prevFrameRef.current;
    const gapMs = prev ? Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, now - transitionRef.current.arrivedAt)) : 250;
    transitionRef.current = {
      arrivedAt: now,
      prevEgo: prev?.ego_pose ?? frame.ego_pose ?? null,
      currEgo: frame.ego_pose ?? null,
      gapMs,
    };
    prevObjectsByIdRef.current = new Map((prev?.objects ?? []).map((o) => [o.track_id, o]));

    if (frame.ego_pose) {
      upsertStaticCells(worldBufferRef.current, frame.grid, frame.ego_pose, RING_BOUNDARIES, now);
    }

    const newEvents = [];
    const seen = seenTracksRef.current;
    const nowIds = new Set();
    for (const obj of frame.objects) {
      nowIds.add(obj.track_id);
      const known = seen.get(obj.track_id);
      if (!known) {
        seen.set(obj.track_id, { is_dynamic: obj.is_dynamic, firstSeenMs: now });
        newEvents.push({ time: clockLabel(), label: `TRACK #${obj.track_id} CONFIRMED · ${classLabel(obj.cls).toUpperCase()}`, cls: obj.cls });
      } else if (known.is_dynamic !== obj.is_dynamic) {
        newEvents.push({ time: clockLabel(), label: `TRACK #${obj.track_id} RECLASSIFIED · ${obj.is_dynamic ? "NOW DYNAMIC" : "NOW STATIC"}`, cls: obj.cls });
        known.is_dynamic = obj.is_dynamic;
      }
    }
    for (const id of Array.from(seen.keys())) {
      if (!nowIds.has(id) && now - seen.get(id).firstSeenMs > 15000) seen.delete(id);
    }

    if (frame.ego_pose) {
      if (lastHeadingEventDegRef.current == null) {
        lastHeadingEventDegRef.current = frame.ego_pose.heading_deg;
      } else {
        const diff = ((frame.ego_pose.heading_deg - lastHeadingEventDegRef.current + 540) % 360) - 180;
        if (Math.abs(diff) >= HEADING_EVENT_THRESHOLD_DEG) {
          newEvents.push({ time: clockLabel(), label: `HEADING CHANGE · ${diff > 0 ? "+" : ""}${diff.toFixed(0)}°`, cls: null });
          lastHeadingEventDegRef.current = frame.ego_pose.heading_deg;
        }
      }
    }

    if (newEvents.length) {
      eventsRef.current = [...newEvents, ...eventsRef.current].slice(0, MAX_EVENTS);
      setEvents(eventsRef.current);
    }

    prevFrameRef.current = frame;
  }, [frame]);

  // Drives the smooth stuff every animation frame.
  useEffect(() => {
    let raf;
    function loop() {
      setTick((v) => (v + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const now = performance.now();
  const { arrivedAt, prevEgo, currEgo, gapMs } = transitionRef.current;
  const frac = Math.min(1, (now - arrivedAt) / gapMs);

  let egoPose = currEgo;
  if (prevEgo && currEgo) {
    egoPose = {
      x: lerp(prevEgo.x, currEgo.x, frac),
      y: lerp(prevEgo.y, currEgo.y, frac),
      heading_deg: lerpAngleDeg(prevEgo.heading_deg, currEgo.heading_deg, frac),
      speed_mps: lerp(prevEgo.speed_mps, currEgo.speed_mps, frac),
    };
  }

  const bufferedCells = egoPose ? projectWorldBuffer(worldBufferRef.current, egoPose, now, MAX_RANGE_M) : [];

  const objects = (frame?.objects ?? []).map((obj) => {
    const prevObj = prevObjectsByIdRef.current.get(obj.track_id);
    const info = seenTracksRef.current.get(obj.track_id);
    const age = info ? now - info.firstSeenMs : NEW_TRACK_GLOW_MS;
    const glowAlpha = age < NEW_TRACK_GLOW_MS ? 1 - age / NEW_TRACK_GLOW_MS : 0;
    if (!prevObj) return { ...obj, glowAlpha };
    return {
      ...obj,
      position: [lerp(prevObj.position[0], obj.position[0], frac), lerp(prevObj.position[1], obj.position[1], frac), obj.position[2]],
      glowAlpha,
    };
  });

  function reset() {
    worldBufferRef.current = createWorldBuffer();
    seenTracksRef.current = new Map();
    eventsRef.current = [];
    lastHeadingEventDegRef.current = null;
    setEvents([]);
  }

  return { egoPose, bufferedCells, objects, events, tick, reset };
}
