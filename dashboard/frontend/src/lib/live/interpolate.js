import { useEffect, useRef, useState } from "react";

const POSITION_SMOOTHING_TAU_MS = 220; // how quickly a position catches up to its target
const HEIGHT_SMOOTHING_TAU_MS = 260;
const ALPHA_SMOOTHING_TAU_MS = 320;
const SCAN_IN_MS = 550; // how long a newly-seen cell/object takes to fully appear
const STALE_TTL_MS = 900; // how long a vanished cell/object keeps fading before being dropped

function approach(current, target, dtMs, tauMs) {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * k;
}

function cellKey(cell) {
  return `${cell.ring}_${cell.angular_bin}`;
}

/**
 * Smooths the wholesale frame swaps useLiveFeed delivers into continuous
 * per-cell / per-object motion for the live 2.5D scene, entirely on top of
 * useLiveFeed's existing contract -- CarView/AdminView, which read `frame`
 * directly, are completely unaffected by this hook's existence.
 *
 * Runs its own requestAnimationFrame loop, independent of message arrival
 * rate: every tick eases each tracked cell/object's current value toward
 * whatever the latest real frame set as its target, and returns a fresh
 * snapshot plus a small log of real state-transition events (new track_id
 * seen, is_dynamic flips) for the event feed -- never a timer-driven fake.
 */
export function useInterpolatedScene(frame) {
  const cellsRef = useRef(new Map());
  const objectsRef = useRef(new Map());
  const eventsRef = useRef([]);
  const lastFrameRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(null);
  const [, forceTick] = useState(0);

  function pushEvent(text, kind, cls = null) {
    eventsRef.current = [
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), text, kind, cls },
      ...eventsRef.current,
    ].slice(0, 12);
  }

  // Apply a newly-arrived real frame as fresh interpolation targets.
  useEffect(() => {
    if (!frame || frame === lastFrameRef.current) return;
    lastFrameRef.current = frame;
    const now = performance.now();

    const seenCellKeys = new Set();
    for (const cell of frame.grid || []) {
      const key = cellKey(cell);
      seenCellKeys.add(key);
      const existing = cellsRef.current.get(key);
      if (existing) {
        existing.cls = cell.cls;
        existing.confidence = cell.confidence;
        existing.targetHeight = cell.height_mean || 0;
        existing.targetAlpha = 1;
        existing.lastSeenAt = now;
      } else {
        cellsRef.current.set(key, {
          ring: cell.ring,
          angular_bin: cell.angular_bin,
          cls: cell.cls,
          confidence: cell.confidence,
          height: 0,
          targetHeight: cell.height_mean || 0,
          alpha: 0,
          targetAlpha: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }
    for (const [key, c] of cellsRef.current) {
      if (!seenCellKeys.has(key)) c.targetAlpha = 0;
    }

    const seenTrackIds = new Set();
    for (const obj of frame.objects || []) {
      seenTrackIds.add(obj.track_id);
      const [fwd, right] = obj.position || [0, 0];
      const existing = objectsRef.current.get(obj.track_id);
      if (existing) {
        existing.targetForward = fwd;
        existing.targetRight = right;
        existing.cls = obj.cls;
        existing.velocity = obj.velocity;
        existing.confidence = obj.confidence;
        existing.targetAlpha = 1;
        if (existing.isDynamic !== obj.is_dynamic) {
          pushEvent(`TRACK #${obj.track_id} ${obj.is_dynamic ? "STARTED MOVING" : "WENT STATIC"}`, "state", obj.cls);
        }
        existing.isDynamic = obj.is_dynamic;
      } else {
        objectsRef.current.set(obj.track_id, {
          trackId: obj.track_id,
          cls: obj.cls,
          forward: fwd,
          right,
          targetForward: fwd,
          targetRight: right,
          velocity: obj.velocity,
          confidence: obj.confidence,
          isDynamic: obj.is_dynamic,
          alpha: 0,
          targetAlpha: 1,
          firstSeenAt: now,
        });
        pushEvent(`NEW TRACK #${obj.track_id} DETECTED`, "new", obj.cls);
      }
    }
    for (const [id, o] of objectsRef.current) {
      if (!seenTrackIds.has(id)) o.targetAlpha = 0;
    }
  }, [frame]);

  // The smoothing loop -- decoupled from message arrival rate.
  useEffect(() => {
    function tick(now) {
      const dt = lastTickRef.current ? now - lastTickRef.current : 16;
      lastTickRef.current = now;

      for (const [key, c] of cellsRef.current) {
        c.height = approach(c.height, c.targetHeight, dt, HEIGHT_SMOOTHING_TAU_MS);
        const scanIn = Math.min(1, (now - c.firstSeenAt) / SCAN_IN_MS);
        c.alpha = approach(c.alpha, c.targetAlpha * scanIn, dt, ALPHA_SMOOTHING_TAU_MS);
        if (c.targetAlpha === 0 && c.alpha < 0.02 && now - c.lastSeenAt > STALE_TTL_MS) {
          cellsRef.current.delete(key);
        }
      }
      for (const [id, o] of objectsRef.current) {
        o.forward = approach(o.forward, o.targetForward, dt, POSITION_SMOOTHING_TAU_MS);
        o.right = approach(o.right, o.targetRight, dt, POSITION_SMOOTHING_TAU_MS);
        const scanIn = Math.min(1, (now - o.firstSeenAt) / SCAN_IN_MS);
        o.alpha = approach(o.alpha, o.targetAlpha * scanIn, dt, ALPHA_SMOOTHING_TAU_MS);
        o.scanIn = scanIn;
        if (o.targetAlpha === 0 && o.alpha < 0.02) objectsRef.current.delete(id);
      }

      forceTick((v) => (v + 1) % 1_000_000);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return {
    cells: Array.from(cellsRef.current.values()),
    objects: Array.from(objectsRef.current.values()),
    events: eventsRef.current,
    pushEvent,
  };
}
