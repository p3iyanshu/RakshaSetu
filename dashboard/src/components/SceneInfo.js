/**
 * Scene Info Panel Component
 * Displays Scenario, Time Elapsed, Vehicle Speed, Heading, Position.
 */

export function createSceneInfo(container) {
  container.innerHTML = `
    <div class="rs-card scene-info-card">
      <div class="card-header">
        <h2 class="card-title">SCENE INFO</h2>
      </div>
      <div class="card-body">
        <div class="info-row">
          <span class="info-label">Scenario</span>
          <span class="info-value" id="scene-scenario">Urban Drive</span>
        </div>
        <div class="info-row">
          <span class="info-label">Time Elapsed</span>
          <span class="info-value font-mono" id="scene-elapsed">01:03.8</span>
        </div>
        <div class="info-row">
          <span class="info-label">Vehicle Speed</span>
          <span class="info-value font-mono" id="scene-speed">20.4 km/h</span>
        </div>
        <div class="info-row">
          <span class="info-label">Heading</span>
          <span class="info-value font-mono" id="scene-heading">0.6° (N)</span>
        </div>
        <div class="info-row">
          <span class="info-label">Position (x, y)</span>
          <span class="info-value font-mono" id="scene-position">(16.8, 128.1) m</span>
        </div>
      </div>
    </div>
  `;

  const scenarioElem = container.querySelector('#scene-scenario');
  const elapsedElem = container.querySelector('#scene-elapsed');
  const speedElem = container.querySelector('#scene-speed');
  const headingElem = container.querySelector('#scene-heading');
  const posElem = container.querySelector('#scene-position');

  return {
    update(sceneData) {
      if (!sceneData) return;
      if (scenarioElem) scenarioElem.textContent = sceneData.scenario || 'Urban Drive';
      if (elapsedElem) elapsedElem.textContent = sceneData.elapsed || '00:00.0';
      if (speedElem) speedElem.textContent = `${(sceneData.speed_kmh || 0).toFixed(1)} km/h`;
      if (headingElem) {
        const deg = (sceneData.heading_deg || 0).toFixed(1);
        const card = sceneData.heading_cardinal || (deg < 0 ? 'W' : 'N');
        headingElem.textContent = `${deg}° (${card})`;
      }
      if (posElem && sceneData.position) {
        posElem.textContent = `(${sceneData.position[0].toFixed(1)}, ${sceneData.position[1].toFixed(1)}) m`;
      }
    }
  };
}
