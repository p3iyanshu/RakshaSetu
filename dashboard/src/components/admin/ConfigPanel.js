/**
 * Admin Console — Configuration
 * Editable forms over CONFIG (lib/config.js). Applying a section writes
 * straight into the live config: the main dashboard tab picks it up on
 * its next animation frame (no reload), synced across tabs via the
 * `storage` event.
 */

import { CONFIG, DEFAULT_CONFIG, updateConfig, resetConfig } from '../../lib/config.js';

const SCENARIOS = ['Urban Drive', 'Pothole Detection', 'Left Turn', 'Dynamic Turn'];
const ELEVATION_CLASSES = [
  { key: 'pothole', label: 'Pothole' },
  { key: 'dynamic_vehicle', label: 'Dynamic Vehicle' },
  { key: 'dynamic_human', label: 'Human' },
  { key: 'static_wall', label: 'Static Wall' },
  { key: 'static_pole', label: 'Static Pole' }
];
const METRIC_FIELDS = [
  { key: 'fps', label: 'FPS', step: '1' },
  { key: 'latency_ms', label: 'Latency (ms)', step: '1' },
  { key: 'miou', label: 'mIoU (%)', step: '0.1' },
  { key: 'grid_cells', label: 'Grid Cells', step: '1' },
  { key: 'compute_savings_pct', label: 'Compute Savings (%)', step: '0.1' },
  { key: 'memory_mb', label: 'Memory (MB)', step: '1' }
];

function field(id, label, value, step) {
  return `
    <label class="admin-field">
      <span>${label}</span>
      <input type="number" step="${step}" id="${id}" value="${value}" />
    </label>`;
}

function textField(id, label, value) {
  return `
    <label class="admin-field">
      <span>${label}</span>
      <input type="text" id="${id}" value="${value}" />
    </label>`;
}

function flashApplied(btn) {
  const original = btn.textContent;
  btn.textContent = 'APPLIED';
  btn.classList.add('admin-btn-applied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('admin-btn-applied');
  }, 1200);
}

export function createConfigPanel(container) {
  container.innerHTML = `
    <div class="rs-card admin-card">
      <div class="card-header">
        <h2 class="card-title">CONFIGURATION</h2>
      </div>
      <div class="card-body admin-config-body">

        <div class="admin-config-section">
          <h3 class="admin-subtitle">Adaptive Grid Resolution</h3>
          <div class="admin-field-grid" id="cfg-grid-rows"></div>
          <button class="admin-btn" id="apply-grid">APPLY</button>
        </div>

        <div class="admin-config-section">
          <h3 class="admin-subtitle">Scenario Speeds (km/h)</h3>
          <div class="admin-field-grid" id="cfg-speeds"></div>
          <button class="admin-btn" id="apply-speeds">APPLY</button>
        </div>

        <div class="admin-config-section">
          <h3 class="admin-subtitle">Elevation by Class (m)</h3>
          <div class="admin-field-grid" id="cfg-elevation"></div>
          <button class="admin-btn" id="apply-elevation">APPLY</button>
        </div>

        <div class="admin-config-section">
          <h3 class="admin-subtitle">Live Metrics Baseline</h3>
          <div class="admin-field-grid" id="cfg-metrics"></div>
          <button class="admin-btn" id="apply-metrics">APPLY</button>
        </div>

        <div class="admin-config-section">
          <h3 class="admin-subtitle">Playback</h3>
          <div class="admin-field-grid" id="cfg-playback"></div>
          <button class="admin-btn" id="apply-playback">APPLY</button>
        </div>

        <button class="admin-btn admin-btn-danger" id="reset-all">RESET ALL TO DEFAULTS</button>
      </div>
    </div>
  `;

  const gridRowsElem = container.querySelector('#cfg-grid-rows');
  const speedsElem = container.querySelector('#cfg-speeds');
  const elevationElem = container.querySelector('#cfg-elevation');
  const metricsElem = container.querySelector('#cfg-metrics');
  const playbackElem = container.querySelector('#cfg-playback');

  function render() {
    gridRowsElem.innerHTML = CONFIG.grid
      .map(
        (row, i) => `
        <div class="admin-field-pair">
          ${textField(`grid-range-${i}`, `Row ${i + 1} Range`, row.range)}
          ${textField(`grid-cell-${i}`, `Row ${i + 1} Cell Size`, row.cellSize)}
        </div>`
      )
      .join('');

    speedsElem.innerHTML = SCENARIOS.map((s) =>
      field(`speed-${s}`, s, CONFIG.scenarioSpeedsKmh[s], '0.1')
    ).join('');

    elevationElem.innerHTML = ELEVATION_CLASSES.map(
      (c) => `
      <div class="admin-field-pair">
        ${field(`elev-sel-${c.key}`, `${c.label} — Selected`, CONFIG.elevationByClass[c.key].selected, '0.01')}
        ${field(`elev-terr-${c.key}`, `${c.label} — Terrain`, CONFIG.elevationByClass[c.key].terrain, '0.01')}
      </div>`
    ).join('');

    metricsElem.innerHTML = METRIC_FIELDS.map((m) =>
      field(`metric-${m.key}`, m.label, CONFIG.metricsBaseline[m.key], m.step)
    ).join('');

    playbackElem.innerHTML = field('ego-speed', 'Ego Base Speed (m/s)', CONFIG.egoSpeedMps, '0.1');
  }

  render();

  container.querySelector('#apply-grid').addEventListener('click', (e) => {
    const grid = CONFIG.grid.map((_, i) => ({
      range: container.querySelector(`#grid-range-${i}`).value,
      cellSize: container.querySelector(`#grid-cell-${i}`).value
    }));
    updateConfig({ grid });
    flashApplied(e.target);
  });

  container.querySelector('#apply-speeds').addEventListener('click', (e) => {
    const scenarioSpeedsKmh = {};
    SCENARIOS.forEach((s) => {
      scenarioSpeedsKmh[s] = Number(container.querySelector(`#speed-${s}`).value);
    });
    updateConfig({ scenarioSpeedsKmh });
    flashApplied(e.target);
  });

  container.querySelector('#apply-elevation').addEventListener('click', (e) => {
    const elevationByClass = {};
    ELEVATION_CLASSES.forEach((c) => {
      elevationByClass[c.key] = {
        selected: Number(container.querySelector(`#elev-sel-${c.key}`).value),
        terrain: Number(container.querySelector(`#elev-terr-${c.key}`).value)
      };
    });
    updateConfig({ elevationByClass });
    flashApplied(e.target);
  });

  container.querySelector('#apply-metrics').addEventListener('click', (e) => {
    const metricsBaseline = {};
    METRIC_FIELDS.forEach((m) => {
      metricsBaseline[m.key] = Number(container.querySelector(`#metric-${m.key}`).value);
    });
    updateConfig({ metricsBaseline });
    flashApplied(e.target);
  });

  container.querySelector('#apply-playback').addEventListener('click', (e) => {
    updateConfig({ egoSpeedMps: Number(container.querySelector('#ego-speed').value) });
    flashApplied(e.target);
  });

  container.querySelector('#reset-all').addEventListener('click', () => {
    resetConfig();
  });

  return {
    refresh: render
  };
}
