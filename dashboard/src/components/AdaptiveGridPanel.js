/**
 * Adaptive Grid (Foveated) Panel Component
 * Displays the Range vs. Cell Size table with cyan cell size values.
 */

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
        <div class="foveated-table-rows">
          <div class="foveated-row">
            <span class="range-val font-mono">0 - 10 m</span>
            <span class="cellsize-val font-mono text-cyan">5 cm</span>
          </div>
          <div class="foveated-row">
            <span class="range-val font-mono">10 - 30 m</span>
            <span class="cellsize-val font-mono text-cyan">15 cm</span>
          </div>
          <div class="foveated-row">
            <span class="range-val font-mono">30 - 60 m</span>
            <span class="cellsize-val font-mono text-cyan">30 cm</span>
          </div>
          <div class="foveated-row">
            <span class="range-val font-mono">60 - 120 m</span>
            <span class="cellsize-val font-mono text-cyan">50 cm</span>
          </div>
        </div>
      </div>
    </div>
  `;

  return {
    update() {
      // Static specification table
    }
  };
}
