/**
 * RakshaSetu Admin-Editable Configuration
 *
 * Single source of truth for the operational values an admin can tune
 * (grid resolution table, scenario speeds, elevation readings, metric
 * baselines, playback speed). worldModel.js and app.js read CONFIG live
 * on every frame, so a change here is reflected on the next render with
 * no reload. Persisted to localStorage and mirrored across tabs via the
 * native `storage` event, so editing the admin console updates any open
 * main-dashboard tab immediately.
 */

const STORAGE_KEY = 'rakshasetu_admin_config';
const EVENT_NAME = 'rakshasetu:config-changed';

const DEFAULTS = {
  grid: [
    { range: '0 - 10 m', cellSize: '5 cm' },
    { range: '10 - 30 m', cellSize: '15 cm' },
    { range: '30 - 60 m', cellSize: '30 cm' },
    { range: '60 - 120 m', cellSize: '50 cm' }
  ],
  scenarioSpeedsKmh: {
    'Urban Drive': 22.1,
    'Pothole Detection': 20.4,
    'Left Turn': 16.9,
    'Dynamic Turn': 18.5
  },
  elevationByClass: {
    pothole: { selected: -0.22, terrain: -0.18 },
    dynamic_vehicle: { selected: 0.12, terrain: 0.03 },
    dynamic_human: { selected: 0.05, terrain: 0.03 },
    static_wall: { selected: 1.20, terrain: 0.05 },
    static_pole: { selected: 0.95, terrain: 0.04 },
    static_tree: { selected: 2.6, terrain: 0.05 },
    default: { selected: 0.12, terrain: 0.03 }
  },
  metricsBaseline: {
    fps: 30,
    latency_ms: 32,
    miou: 87.5,
    grid_cells: 13400,
    compute_savings_pct: 62.8,
    memory_mb: 432
  },
  egoSpeedMps: 5.8
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      target[key] = target[key] && typeof target[key] === 'object' ? target[key] : {};
      deepMerge(target[key], val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

export const CONFIG = deepClone(DEFAULTS);
export const DEFAULT_CONFIG = deepClone(DEFAULTS);

function loadFromStorage() {
  // Rebuild from DEFAULTS every time (not just merge on top of the current
  // CONFIG) so that another tab clearing storage via resetConfig() actually
  // resets this tab's CONFIG too, instead of leaving stale overrides in place.
  const fresh = deepClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) deepMerge(fresh, JSON.parse(raw));
  } catch (e) {
    // Malformed or inaccessible storage — fall back to plain defaults.
  }
  Object.keys(CONFIG).forEach((k) => delete CONFIG[k]);
  deepMerge(CONFIG, fresh);
}
loadFromStorage();

export function updateConfig(patch) {
  deepMerge(CONFIG, patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG));
  } catch (e) {
    // Storage unavailable (private browsing, etc.) — config still updates in-memory for this tab.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function resetConfig() {
  Object.keys(CONFIG).forEach((k) => delete CONFIG[k]);
  deepMerge(CONFIG, deepClone(DEFAULTS));
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Ignore.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function onConfigChange(handler) {
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      loadFromStorage();
      handler();
    }
  });
}
