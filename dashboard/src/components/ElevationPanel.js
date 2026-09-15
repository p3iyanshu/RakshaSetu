/**
 * Elevation (2.5D) Panel Component
 * Displays Selected Cell Height, Local Terrain Height, and the 2.5D gradient scale bar.
 */

export function createElevationPanel(container) {
  container.innerHTML = `
    <div class="rs-card elevation-card">
      <div class="card-header">
        <h2 class="card-title">ELEVATION (2.5D)</h2>
      </div>
      <div class="card-body elevation-body">
        <div class="elevation-rows">
          <div class="info-row">
            <span class="info-label">Selected Cell Height</span>
            <span class="info-value font-mono" id="elev-selected-height">-0.22 m</span>
          </div>
          <div class="info-row">
            <span class="info-label">Local Terrain Height</span>
            <span class="info-value font-mono" id="elev-terrain-height">-0.18 m</span>
          </div>
        </div>

        <div class="elevation-scale-wrap">
          <div class="elevation-gradient-bar"></div>
          <div class="elevation-ticks">
            <span>-0.5</span>
            <span>0</span>
            <span>0.5</span>
            <span>1.0</span>
            <span>1.5 m</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const selHeightElem = container.querySelector('#elev-selected-height');
  const terrainHeightElem = container.querySelector('#elev-terrain-height');

  return {
    update(elevationData) {
      if (!elevationData) return;
      const selVal = Number(elevationData.selected_cell_height_m ?? -0.22);
      const terrVal = Number(elevationData.local_terrain_height_m ?? -0.18);

      if (selHeightElem) {
        selHeightElem.textContent = `${selVal >= 0 ? '+' : ''}${selVal.toFixed(2)} m`;
        if (selVal < -0.1) {
          selHeightElem.className = 'info-value font-mono text-purple';
        } else if (selVal > 0.3) {
          selHeightElem.className = 'info-value font-mono text-yellow';
        } else {
          selHeightElem.className = 'info-value font-mono text-cyan';
        }
      }

      if (terrainHeightElem) {
        terrainHeightElem.textContent = `${terrVal >= 0 ? '+' : ''}${terrVal.toFixed(2)} m`;
      }
    }
  };
}
