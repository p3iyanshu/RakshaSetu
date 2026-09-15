/**
 * Semantic Legend Component
 * Matches the 5-row legend from the reference screenshots (resolving Step 3 discrepancy).
 */

export function createSemanticLegend(container) {
  container.innerHTML = `
    <div class="rs-card semantic-legend-card">
      <div class="card-header">
        <h2 class="card-title">SEMANTIC LEGEND</h2>
      </div>
      <div class="card-body">
        <div class="legend-list">
          <div class="legend-item">
            <span class="legend-dot dot-drivable"></span>
            <span class="legend-label">Drivable (Road/Terrain)</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot dot-wall"></span>
            <span class="legend-label">Static Wall</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot dot-pole"></span>
            <span class="legend-label">Static Pole</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot dot-vehicle"></span>
            <span class="legend-label">Dynamic Vehicle</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot dot-unclassified"></span>
            <span class="legend-label">Unclassified</span>
          </div>
        </div>
      </div>
    </div>
  `;

  return {
    update() {
      // Static legend
    }
  };
}
