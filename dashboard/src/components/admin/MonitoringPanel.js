/**
 * Admin Console — Live Monitoring
 * Read-only "reviewer" view: scene state, metric sparklines, the full
 * tracked-objects table, and a detection log derived from the actual
 * frame data (which track IDs newly appeared, when the scenario changed)
 * rather than duplicating app.js's landmark-distance thresholds.
 */

const METRIC_DEFS = [
  { key: 'fps', label: 'FPS', decimals: 0, color: '#00f2fe' },
  { key: 'latency_ms', label: 'LATENCY', decimals: 0, suffix: 'ms', color: '#facc15' },
  { key: 'miou', label: 'mIoU', decimals: 1, suffix: '%', color: '#00e676' },
  { key: 'grid_cells', label: 'GRID CELLS', decimals: 0, color: '#c084fc' },
  { key: 'compute_savings_pct', label: 'COMPUTE SAVINGS', decimals: 1, suffix: '%', color: '#f97316' },
  { key: 'memory_mb', label: 'MEMORY', decimals: 0, suffix: 'MB', color: '#8e9eab' }
];

const HISTORY_LEN = 60;

function drawSparkline(canvas, data, color) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function createMonitoringPanel(container) {
  container.innerHTML = `
    <div class="rs-card admin-card">
      <div class="card-header">
        <h2 class="card-title">LIVE MONITORING</h2>
      </div>
      <div class="card-body admin-monitoring-body">

        <div class="admin-scene-strip" id="admin-scene-strip"></div>

        <div class="admin-metrics-grid" id="admin-metrics-grid">
          ${METRIC_DEFS.map(
            (m) => `
            <div class="admin-metric-tile">
              <span class="admin-metric-label">${m.label}</span>
              <span class="admin-metric-value font-mono" id="admin-metric-${m.key}">--</span>
              <canvas class="admin-sparkline" id="admin-spark-${m.key}" width="120" height="26"></canvas>
            </div>`
          ).join('')}
        </div>

        <div class="admin-split">
          <div class="admin-objects-wrap">
            <h3 class="admin-subtitle">TRACKED OBJECTS</h3>
            <div class="admin-table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Class</th><th>Position</th><th>Vel (m/s)</th><th>Dist (m)</th><th>Conf.</th><th>Status</th>
                  </tr>
                </thead>
                <tbody id="admin-objects-body"></tbody>
              </table>
            </div>
          </div>
          <div class="admin-events-wrap">
            <h3 class="admin-subtitle">DETECTION LOG</h3>
            <div class="admin-event-list" id="admin-event-list"></div>
          </div>
        </div>

      </div>
    </div>
  `;

  const sceneStripElem = container.querySelector('#admin-scene-strip');
  const objectsBodyElem = container.querySelector('#admin-objects-body');
  const eventListElem = container.querySelector('#admin-event-list');
  const sparkCanvases = Object.fromEntries(
    METRIC_DEFS.map((m) => [m.key, container.querySelector(`#admin-spark-${m.key}`)])
  );
  const valueElems = Object.fromEntries(
    METRIC_DEFS.map((m) => [m.key, container.querySelector(`#admin-metric-${m.key}`)])
  );

  const history = Object.fromEntries(METRIC_DEFS.map((m) => [m.key, []]));
  let previousTrackIds = new Set();
  let previousScenario = null;
  const events = [];

  function pushEvent(text, color) {
    events.unshift({ time: new Date().toLocaleTimeString('en-GB'), text, color });
    if (events.length > 10) events.pop();
    eventListElem.innerHTML = events
      .map(
        (e) => `
        <div class="admin-event-row">
          <span class="admin-event-time font-mono">${e.time}</span>
          <span class="admin-event-dot" style="background:${e.color}"></span>
          <span class="admin-event-text">${e.text}</span>
        </div>`
      )
      .join('');
  }

  return {
    update(frame) {
      if (!frame) return;

      sceneStripElem.innerHTML = `
        <span><b>Scenario</b> ${frame.scene.scenario}</span>
        <span><b>Elapsed</b> ${frame.scene.elapsed}</span>
        <span><b>Speed</b> ${frame.scene.speed_kmh.toFixed(1)} km/h</span>
        <span><b>Heading</b> ${frame.scene.heading_deg}&deg; (${frame.scene.heading_cardinal})</span>
        <span><b>Position</b> (${frame.scene.position[0]}, ${frame.scene.position[1]})</span>
        <span><b>Mode</b> ${frame.scene.mode}</span>
      `;

      METRIC_DEFS.forEach((m) => {
        const val = frame.metrics[m.key];
        history[m.key].push(val);
        if (history[m.key].length > HISTORY_LEN) history[m.key].shift();
        if (valueElems[m.key]) {
          valueElems[m.key].textContent = `${val.toFixed(m.decimals)}${m.suffix || ''}`;
        }
        drawSparkline(sparkCanvases[m.key], history[m.key], m.color);
      });

      objectsBodyElem.innerHTML = frame.objects
        .map(
          (o) => `
        <tr>
          <td class="font-mono">#${o.track_id}</td>
          <td>${o.ui_class || o.class}</td>
          <td class="font-mono">${o.position[0]}, ${o.position[1]}</td>
          <td class="font-mono">${o.velocity_mps.toFixed(1)}</td>
          <td class="font-mono">${o.distance_m}</td>
          <td class="font-mono">${o.confidence}%</td>
          <td>${o.status}</td>
        </tr>`
        )
        .join('');

      if (frame.scene.scenario !== previousScenario) {
        if (previousScenario !== null) {
          pushEvent(`Scenario changed &rarr; ${frame.scene.scenario}`, '#00f2fe');
        }
        previousScenario = frame.scene.scenario;
      }

      const currentIds = new Set(frame.objects.map((o) => String(o.track_id)));
      frame.objects.forEach((o) => {
        if (!previousTrackIds.has(String(o.track_id))) {
          pushEvent(`${o.ui_class || o.class} #${o.track_id} detected`, o.is_dynamic ? '#facc15' : '#00e676');
        }
      });
      previousTrackIds = currentIds;
    }
  };
}
