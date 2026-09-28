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
 */

const OTHER_UNKNOWN = 5;
const CONF_THRESHOLD = 50;          // percent; frame confidences are 0-100
const MIN_STATIONARY_FRAMES = 5;

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
  const raised = new Set();    // track_ids currently alerting
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
        if (qualifies(obj)) streaks.set(id, (streaks.get(id) || 0) + 1);
        else streaks.delete(id);
      }
      for (const id of [...streaks.keys()]) if (!seen.has(id)) streaks.delete(id);

      const active = (frame?.objects || [])
        .filter(o => (streaks.get(String(o.track_id)) || 0) >= MIN_STATIONARY_FRAMES)
        .sort((a, b) => a.distance_m - b.distance_m);
      const activeIds = new Set(active.map(o => String(o.track_id)));

      for (const o of active) {
        const id = String(o.track_id);
        if (!raised.has(id) && onRaise) onRaise(o);
      }
      raised.clear();
      activeIds.forEach(id => raised.add(id));

      const html = active.map(o => `
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
