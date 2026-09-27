/**
 * Admin Console — Grid Comparison Component
 * Displays the side-by-side Uniform vs. Adaptive (Foveated) comparison
 * matching the SIH PS 26053 specification, with interactive toggle buttons
 * that drive the live LiDAR feed perception mode.
 */

export function createGridComparisonPanel(container, onModeChange) {
  container.innerHTML = `
    <div class="rs-card admin-grid-comp-card">
      <div class="card-header grid-comp-header">
        <h2 class="card-title">GRID COMPARISON</h2>
        <span class="badge-compute-save" id="comp-save-badge">&minus;63% COMPUTE</span>
      </div>

      <div class="card-body grid-comp-body">
        <div class="grid-live-toggle-row">
          <span class="toggle-feed-label">DRIVE LIVE FEED AT</span>
          <div class="toggle-btn-group">
            <button type="button" class="grid-toggle-btn" data-mode="uniform">UNIFORM</button>
            <button type="button" class="grid-toggle-btn active" data-mode="adaptive">ADAPTIVE</button>
          </div>
        </div>

        <div class="grid-compare-visuals">
          <!-- Uniform Grid Box -->
          <div class="grid-col uniform-col" id="col-uniform">
            <div class="grid-visual-box uniform-visual-box">
              <svg class="grid-svg uniform-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <pattern id="uniform-grid-pattern" width="6.25" height="6.25" patternUnits="userSpaceOnUse">
                    <path d="M 6.25 0 L 0 0 0 6.25" fill="none" stroke="rgba(239, 68, 68, 0.45)" stroke-width="0.75"/>
                  </pattern>
                </defs>
                <rect width="100" height="100" fill="url(#uniform-grid-pattern)"/>
                <rect width="100" height="100" fill="none" stroke="rgba(239, 68, 68, 0.6)" stroke-width="1"/>
              </svg>
            </div>
            <div class="grid-col-caption">
              <span class="caption-title">UNIFORM</span>
              <span class="caption-cells"><strong class="font-mono">1,200,000</strong> cells</span>
            </div>
          </div>

          <!-- Adaptive (Foveated) Grid Box -->
          <div class="grid-col adaptive-col active-col" id="col-adaptive">
            <div class="grid-visual-box adaptive-visual-box">
              <svg class="grid-svg adaptive-svg" viewBox="0 0 100 100">
                <defs>
                  <pattern id="adaptive-center-grid" width="5" height="5" patternUnits="userSpaceOnUse">
                    <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(16, 185, 129, 0.75)" stroke-width="0.8"/>
                  </pattern>
                  <clipPath id="circle-clip">
                    <circle cx="50" cy="50" r="42"/>
                  </clipPath>
                </defs>

                <!-- Circular background & mask -->
                <circle cx="50" cy="50" r="42" fill="#071415" stroke="rgba(16, 185, 129, 0.5)" stroke-width="1"/>
                
                <!-- Clipped foveated grid -->
                <g clip-path="url(#circle-clip)">
                  <!-- Outer coarser grid -->
                  <path d="M 0 20 L 100 20 M 0 35 L 100 35 M 0 50 L 100 50 M 0 65 L 100 65 M 0 80 L 100 80
                           M 20 0 L 20 100 M 35 0 L 35 100 M 50 0 L 50 100 M 65 0 L 65 100 M 80 0 L 80 100" 
                        fill="none" stroke="rgba(0, 242, 254, 0.35)" stroke-width="0.75"/>

                  <!-- Fine dense central fovea (5cm high-resolution zone) -->
                  <circle cx="50" cy="50" r="22" fill="url(#adaptive-center-grid)"/>
                  <circle cx="50" cy="50" r="22" fill="none" stroke="rgba(16, 185, 129, 0.85)" stroke-width="0.8" stroke-dasharray="2,2"/>
                  <circle cx="50" cy="50" r="10" fill="none" stroke="rgba(0, 242, 254, 0.9)" stroke-width="0.8"/>

                  <!-- Polar radial crosshairs -->
                  <line x1="8" y1="50" x2="92" y2="50" stroke="rgba(16, 185, 129, 0.45)" stroke-width="0.7"/>
                  <line x1="50" y1="8" x2="50" y2="92" stroke="rgba(16, 185, 129, 0.45)" stroke-width="0.7"/>
                </g>
              </svg>
            </div>
            <div class="grid-col-caption">
              <span class="caption-title">ADAPTIVE</span>
              <span class="caption-cells"><strong class="font-mono" id="adaptive-cells-num">444,599</strong> cells</span>
              <span class="caption-sub font-mono">5cm@10m &rarr; 50cm@100m</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let currentMode = 'adaptive';
  const toggleBtns = container.querySelectorAll('.grid-toggle-btn');
  const saveBadge = container.querySelector('#comp-save-badge');
  const colUniform = container.querySelector('#col-uniform');
  const colAdaptive = container.querySelector('#col-adaptive');

  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      if (mode === currentMode) return;
      setMode(mode);
    });
  });

  function setMode(mode) {
    currentMode = mode;
    toggleBtns.forEach((b) => {
      const isCurrent = b.getAttribute('data-mode') === mode;
      b.classList.toggle('active', isCurrent);
    });

    if (mode === 'uniform') {
      colUniform.classList.add('active-col');
      colAdaptive.classList.remove('active-col');
      saveBadge.textContent = '+170% OVERLOAD';
      saveBadge.className = 'badge-compute-save overload';
    } else {
      colAdaptive.classList.add('active-col');
      colUniform.classList.remove('active-col');
      saveBadge.innerHTML = '&minus;63% COMPUTE';
      saveBadge.className = 'badge-compute-save';
    }

    if (onModeChange) {
      onModeChange(mode);
    }
  }

  return {
    getMode() {
      return currentMode;
    },
    setMode(mode) {
      setMode(mode);
    },
    update(frame) {
      // Small jitter or dynamic cell count reflecting actual frame if desired
      const cellsElem = container.querySelector('#adaptive-cells-num');
      if (cellsElem && frame?.metrics?.active_cells) {
        cellsElem.textContent = Number(frame.metrics.active_cells).toLocaleString();
      }
    }
  };
}
