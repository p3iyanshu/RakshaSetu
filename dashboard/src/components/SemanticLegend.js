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
          <div class="legend-item"><span class="legend-dot dot-drivable"></span><span class="legend-label">Drivable (Road/Terrain)</span></div>
          <div class="legend-item"><span class="legend-dot dot-wall"></span><span class="legend-label">Static Wall</span></div>
          <div class="legend-item"><span class="legend-dot dot-pole"></span><span class="legend-label">Static Pole</span></div>
          <div class="legend-item"><span class="legend-dot dot-tree"></span><span class="legend-label">Static Tree</span></div>
          <div class="legend-item"><span class="legend-dot dot-vehicle"></span><span class="legend-label">Dynamic Vehicle</span></div>
          <div class="legend-item"><span class="legend-dot dot-human"></span><span class="legend-label">Human</span></div>
          <div class="legend-item"><span class="legend-dot dot-pothole"></span><span class="legend-label">Pothole / Negative Obstacle</span></div>
          <div class="legend-item"><span class="legend-dot dot-curb"></span><span class="legend-label">Curb</span></div>
          <div class="legend-item"><span class="legend-dot dot-unclassified"></span><span class="legend-label">Unclassified</span></div>
        </div>
        <div class="legend-divider"></div>
        <div class="legend-list">
          <div class="legend-item"><span class="legend-line line-contour"></span><span class="legend-label">Terrain Contour (5 / 25 m)</span></div>
          <div class="legend-item"><span class="legend-line line-ring"></span><span class="legend-label">Foveated Range Ring</span></div>
          <div class="legend-item"><span class="legend-line line-path"></span><span class="legend-label">Planned Trajectory</span></div>
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
