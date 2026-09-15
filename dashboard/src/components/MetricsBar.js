/**
 * Bottom Metrics Bar Component
 * Displays 6 Stat Tiles (FPS, LATENCY, mIoU, GRID CELLS, COMPUTE SAVINGS, MEMORY USAGE)
 * and the Playback Controls (Pause, Restart, Speed).
 */

export function createMetricsBar(container, controls = {}) {
  container.innerHTML = `
    <footer class="rs-bottom-bar">
      <div class="metrics-grid">
        <div class="metric-tile">
          <span class="metric-label">FPS</span>
          <span class="metric-value font-mono" id="metric-fps">31</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">LATENCY</span>
          <span class="metric-value font-mono"><span id="metric-latency">32</span><span class="metric-unit">ms</span></span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">mIoU</span>
          <span class="metric-value font-mono"><span id="metric-miou">88.1</span><span class="metric-unit">%</span></span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">GRID CELLS</span>
          <span class="metric-value font-mono" id="metric-grid-cells">13,904</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">COMPUTE SAVINGS</span>
          <span class="metric-value font-mono"><span id="metric-compute-savings">63.4</span><span class="metric-unit">%</span></span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">MEMORY USAGE</span>
          <span class="metric-value font-mono"><span id="metric-memory">436</span><span class="metric-unit">MB</span></span>
        </div>
      </div>

      <div class="bottom-controls">
        <button id="btn-pause" class="ctrl-btn" title="Toggle Play / Pause">
          <span class="ctrl-icon" id="pause-icon">❚❚</span>
          <span id="pause-text">Pause</span>
        </button>

        <button id="btn-restart" class="ctrl-btn" title="Restart Scenario Playback">
          <span class="ctrl-icon">⟲</span>
          <span>Restart</span>
        </button>

        <div class="speed-dropdown-wrap">
          <select id="speed-select" class="speed-select" aria-label="Playback speed">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
          <span class="dropdown-arrow">∨</span>
        </div>
      </div>
    </footer>
  `;

  const fpsElem = container.querySelector('#metric-fps');
  const latencyElem = container.querySelector('#metric-latency');
  const miouElem = container.querySelector('#metric-miou');
  const cellsElem = container.querySelector('#metric-grid-cells');
  const savingsElem = container.querySelector('#metric-compute-savings');
  const memoryElem = container.querySelector('#metric-memory');

  const pauseBtn = container.querySelector('#btn-pause');
  const pauseIcon = container.querySelector('#pause-icon');
  const pauseText = container.querySelector('#pause-text');
  const restartBtn = container.querySelector('#btn-restart');
  const speedSelect = container.querySelector('#speed-select');

  let isPaused = false;

  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) {
      pauseIcon.textContent = '▶';
      pauseText.textContent = 'Resume';
      pauseBtn.classList.add('active-paused');
    } else {
      pauseIcon.textContent = '❚❚';
      pauseText.textContent = 'Pause';
      pauseBtn.classList.remove('active-paused');
    }
    if (controls.onTogglePause) controls.onTogglePause(isPaused);
  });

  restartBtn.addEventListener('click', () => {
    if (controls.onRestart) controls.onRestart();
  });

  speedSelect.addEventListener('change', (e) => {
    if (controls.onSpeedChange) controls.onSpeedChange(parseFloat(e.target.value));
  });

  return {
    update(metricsData) {
      if (!metricsData) return;
      if (fpsElem) fpsElem.textContent = metricsData.fps ?? 31;
      if (latencyElem) latencyElem.textContent = metricsData.latency_ms ?? 32;
      if (miouElem) miouElem.textContent = Number(metricsData.miou ?? 88.1).toFixed(1);
      if (cellsElem) {
        const count = metricsData.grid_cells ?? 13904;
        cellsElem.textContent = count.toLocaleString();
      }
      if (savingsElem) savingsElem.textContent = Number(metricsData.compute_savings_pct ?? 63.4).toFixed(1);
      if (memoryElem) memoryElem.textContent = metricsData.memory_mb ?? 436;
    },
    setPaused(paused) {
      isPaused = paused;
      if (isPaused) {
        pauseIcon.textContent = '▶';
        pauseText.textContent = 'Resume';
        pauseBtn.classList.add('active-paused');
      } else {
        pauseIcon.textContent = '❚❚';
        pauseText.textContent = 'Pause';
        pauseBtn.classList.remove('active-paused');
      }
    }
  };
}
