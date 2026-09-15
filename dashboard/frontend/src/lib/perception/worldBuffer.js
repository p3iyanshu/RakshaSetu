// Persistence buffer for static-class grid cells (wall/pole): as the
// vehicle drives, geometry it has already seen stays visible -- transformed
// into world coordinates via the real per-frame ego_pose and re-projected
// back into whatever the CURRENT ego-relative view is -- instead of the
// scene redrawing from a blank grid every frame. Keyed by a rounded world
// position so revisiting the same spot updates one entry rather than
// duplicating it; entries fade out with age so stale geometry eventually
// clears instead of accumulating forever.
//
// Coordinate convention (matches build_demo_data.py's _extract_ego_pose):
// sensor/ego-relative (localX, localY) = (forward, right); ego_pose.heading_deg
// is 0 at world +z and increases CLOCKWISE toward world +x (derived from
// atan2(forward_world.x, forward_world.z)). The rotation below is the one
// consistent with that: at heading=0, forward->+z and right->+x.

import { STATIC_OBSTACLE_CLASSES } from "../colors.js";

const CELL_SNAP_M = 0.5; // world-position rounding bucket for the Map key
export const MAX_AGE_MS = 8000; // fades fully out after this long unseen

export function createWorldBuffer() {
  return new Map(); // key "x_y" -> { worldX, worldY, cls, heightMax, heightMean, confidence, lastSeenMs }
}

function toWorld(localX, localY, egoPose) {
  const h = (egoPose.heading_deg * Math.PI) / 180;
  const s = Math.sin(h);
  const c = Math.cos(h);
  return {
    worldX: egoPose.x + localX * s + localY * c,
    worldY: egoPose.y + localX * c - localY * s,
  };
}

// This rotation matrix is symmetric and its own inverse, so "world back to
// ego-relative" reuses the same sin/cos rather than a separately-derived
// inverse transform.
function toLocal(worldX, worldY, egoPose) {
  const h = (egoPose.heading_deg * Math.PI) / 180;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const dx = worldX - egoPose.x;
  const dy = worldY - egoPose.y;
  return { localX: dx * s + dy * c, localY: dx * c - dy * s };
}

/** Call once per real incoming frame (not per animation tick) -- upserts
 * this frame's static cells using that frame's own real ego_pose. */
export function upsertStaticCells(buffer, cells, egoPose, ringBoundaries, nowMs) {
  if (!egoPose || !cells) return;
  for (const cell of cells) {
    if (cell.point_count === 0 || !STATIC_OBSTACLE_CLASSES.has(cell.cls)) continue;
    const band = ringBoundaries[cell.ring];
    if (!band) continue;
    const rMid = (band.lo + band.hi) / 2;
    const angleRad = ((cell.angular_bin + 0.5) * 10 * Math.PI) / 180;
    const localX = rMid * Math.cos(angleRad);
    const localY = rMid * Math.sin(angleRad);
    const { worldX, worldY } = toWorld(localX, localY, egoPose);
    const key = `${Math.round(worldX / CELL_SNAP_M)}_${Math.round(worldY / CELL_SNAP_M)}`;
    buffer.set(key, {
      worldX,
      worldY,
      cls: cell.cls,
      heightMax: cell.height_max,
      heightMean: cell.height_mean,
      confidence: cell.confidence,
      lastSeenMs: nowMs,
    });
  }
}

/** Call every animation tick with the current (possibly interpolated)
 * ego_pose -- re-expresses buffered world geometry in ego-relative
 * coordinates for rendering, ages/drops stale entries, and fades by age. */
export function projectWorldBuffer(buffer, egoPose, nowMs, maxRangeM) {
  if (!egoPose) return [];
  const out = [];
  for (const [key, entry] of buffer) {
    const age = nowMs - entry.lastSeenMs;
    if (age > MAX_AGE_MS) {
      buffer.delete(key);
      continue;
    }
    const { localX, localY } = toLocal(entry.worldX, entry.worldY, egoPose);
    const rangeM = Math.hypot(localX, localY);
    if (rangeM > maxRangeM) continue;
    out.push({
      x: localX,
      y: localY,
      cls: entry.cls,
      heightMax: entry.heightMax,
      heightMean: entry.heightMean,
      confidence: entry.confidence,
      alpha: Math.max(0, 1 - age / MAX_AGE_MS),
    });
  }
  return out;
}
