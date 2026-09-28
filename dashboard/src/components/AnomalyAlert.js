/**
 * Unidentified-object alert for the Live Perception view.
 *
 * Driven only by the real frame.objects stream, using fields the pipeline
 * already emits. A track raises the alert when it is:
 *   - class OTHER_UNKNOWN (cls 5): the segmenter could not place it, AND
 *   - below the confidence threshold, AND
 *   - stationary (is_dynamic false) for MIN_STATIONARY_FRAMES consecutive frames.
 * It clears as soon as the track moves, is reclassified, gains confidence,
 * or leaves the frame, so no alert outlives its evidence.
 *
 * LiDAR measures geometry only; this flags "can't classify it and it isn't
 * moving" for a human to inspect. It makes no claim about what the object is.
 *
 * Separately, a track whose class is 'explosive' raises an EXPLOSIVE alert
 * immediately. That label comes only from the simulation scenario (see
 * worldModel.js), never from LiDAR segmentation.
 */

const OTHER_UNKNOWN = 5;
const CONF_THRESHOLD = 50;          // percent; frame confidences are 0-100
const MIN_STATIONARY_FRAMES = 5;

function isExplosive(obj) {
  return obj.class === 'explosive';
}

function qualifies(obj) {
  return obj.cls === OTHER_UNKNOWN && obj.confidence < CONF_THRESHOLD && obj.is_dynamic === false;
}

export function createAnomalyAlert(mapContainer, { onRaise, onSelect } = {}) {
  const root = document.createElement('div');
  root.className = 'anomaly-alert-stack';
  root.setAttribute('role', 'alert');
  root.setAttribute('aria-live', 'assertive');
  mapContainer.appendChild(root);

  const streaks = new Map();   // track_id -> consecutive qualifying frames
  const raised = new Map();    // track_id -> 'explosive' | 'unknown' currently alerting
  let lastHtml = '';

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (el && onSelect) onSelect(el.dataset.track);
  });

  return {
    /** Feed one frame; returns the set of track ids currently alerting. */
    update(frame) {
      const seen = new Set();
      for (const obj of frame?.objects || []) {
        const id = String(obj.track_id);
        seen.add(id);
        if (isExplosive(obj)) streaks.set(id, MIN_STATIONARY_FRAMES);   // no warm-up needed
        else if (qualifies(obj)) streaks.set(id, (streaks.get(id) || 0) + 1);
        else streaks.delete(id);
      }
      for (const id of [...streaks.keys()]) if (!seen.has(id)) streaks.delete(id);

      const active = (frame?.objects || [])
        .filter(o => (streaks.get(String(o.track_id)) || 0) >= MIN_STATIONARY_FRAMES)
        .sort((a, b) => (isExplosive(b) - isExplosive(a)) || (a.distance_m - b.distance_m));
      const activeIds = new Set(active.map(o => String(o.track_id)));

      // Notify on a new alert, including escalation from unknown to explosive
      const next = new Map();
      for (const o of active) {
        const id = String(o.track_id);
        const kind = isExplosive(o) ? 'explosive' : 'unknown';
        if (raised.get(id) !== kind && onRaise) onRaise(o, kind);
        next.set(id, kind);
      }
      raised.clear();
      next.forEach((kind, id) => raised.set(id, kind));

      const html = active.map(o => isExplosive(o) ? `
        <button type="button" class="anomaly-alert is-explosive" data-track="${o.track_id}" title="Select track #${o.track_id} on the map">
          <span class="anomaly-alert-icon" aria-hidden="true">!</span>
          <span class="anomaly-alert-body">
            <span class="anomaly-alert-title">EXPLOSIVE DETECTED — TRACK #${o.track_id} — HALT &amp; KEEP CLEAR</span>
            <span class="anomaly-alert-meta font-mono">${o.distance_m.toFixed(1)} m · ${o.position[0] < 0 ? 'left' : 'right'} shoulder · conf ${o.confidence}% · scenario label (simulated)</span>
          </span>
        </button>` : `
        <button type="button" class="anomaly-alert" data-track="${o.track_id}" title="Select track #${o.track_id} on the map">
          <span class="anomaly-alert-icon" aria-hidden="true">!</span>
          <span class="anomaly-alert-body">
            <span class="anomaly-alert-title">UNIDENTIFIED OBJECT — TRACK #${o.track_id} — RECOMMEND INSPECTION</span>
            <span class="anomaly-alert-meta font-mono">OTHER_UNKNOWN · conf ${o.confidence}% · stationary · ${o.distance_m.toFixed(1)} m</span>
          </span>
        </button>`).join('');
      if (html !== lastHtml) {
        root.innerHTML = html;
        lastHtml = html;
      }
      return activeIds;
    }
  };
}
