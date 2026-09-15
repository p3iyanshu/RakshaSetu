/**
 * Header Component
 * Exactly matches Top Bar from the 3 reference screenshots.
 */

export function createHeader(container, onScenarioChange) {
  container.innerHTML = `
    <header class="rs-header">
      <div class="header-left">
        <div class="rs-logo-badge">RS</div>
        <div class="rs-title-group">
          <h1 class="rs-title">RAKSHASETU</h1>
          <span class="rs-subtitle">ADAPTIVE 2.5D LIDAR PERCEPTION · SIH PS 26053 · DRDO</span>
        </div>
      </div>

      <div class="header-center">
        <div class="live-perception-pill" id="live-perception-badge" title="Click to cycle scenario">
          <span class="pulse-cyan-dot"></span>
          <span>LIVE PERCEPTION</span>
        </div>
      </div>

      <div class="header-right">
        <div class="mode-pill" id="mode-pill-btn" title="Click to switch scenario">
          <span class="mode-label">MODE</span>
          <span class="mode-val" id="mode-val-text">SIMULATION (CARLA)</span>
          <span class="mode-dropdown-caret">▾</span>
        </div>

        <div class="status-pill">
          <span class="online-dot"></span>
          <span class="status-text">SYSTEM ONLINE</span>
        </div>

        <div class="clock-display" id="system-clock">17:55:12</div>
      </div>
    </header>
  `;

  // Clicking "LIVE PERCEPTION" or "MODE" cycles scenarios
  let curScen = 2;
  const liveBadge = container.querySelector('#live-perception-badge');
  const modePill = container.querySelector('#mode-pill-btn');

  function cycleScenario() {
    curScen = (curScen + 1) % 4;
    if (onScenarioChange) onScenarioChange(curScen);
  }

  liveBadge.addEventListener('click', cycleScenario);
  modePill.addEventListener('click', cycleScenario);

  return {
    update(sceneData, scenarioIndex) {
      if (!sceneData) return;
      const clockElem = container.querySelector('#system-clock');
      if (clockElem && sceneData.system_time) {
        clockElem.textContent = sceneData.system_time;
      }
      if (scenarioIndex !== undefined) {
        curScen = scenarioIndex;
      }
    }
  };
}
