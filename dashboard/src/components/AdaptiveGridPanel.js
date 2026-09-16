/**
 * Adaptive Grid (Foveated) Panel Component
 * Displays the Range vs. Cell Size table with cyan cell size values.
 * Rows come from CONFIG.grid (see lib/config.js) so the admin console
 * can retune the resolution table live.
 */

import { CONFIG } from '../lib/config.js';

function renderRows() {
  return CONFIG.grid
    .map(
      (row) => `
          <div class="foveated-row">
            <span class="range-val font-mono">${row.range}</span>
            <span class="cellsize-val font-mono text-cyan">${row.cellSize}</span>
          </div>`
    )
    .join('');
}

export function createAdaptiveGridPanel(container) {
  container.innerHTML = `
    <div class="rs-card adaptive-grid-card">
      <div class="card-header">
        <h2 class="card-title">ADAPTIVE GRID (FOVEATED)</h2>
      </div>
      <div class="card-body">
        <div class="foveated-table-header">
          <span>Range</span>
          <span class="cross-icon">✕</span>
          <span>Cell Size</span>
        </div>
        <div class="foveated-table-rows" id="foveated-table-rows">${renderRows()}</div>
      </div>
    </div>
  `;

  const rowsElem = container.querySelector('#foveated-table-rows');

  return {
    update() {
      if (rowsElem) rowsElem.innerHTML = renderRows();
    }
  };
}
