/**
 * Selected Object Panel Component
 * Displays Class, Track ID, Distance, Velocity, Confidence, Status,
 * and a high-fidelity dynamic visual preview matching each entity type.
 */

export function createSelectedObject(container) {
  container.innerHTML = `
    <div class="rs-card selected-object-card">
      <div class="card-header">
        <h2 class="card-title">SELECTED OBJECT</h2>
      </div>
      <div class="card-body selected-object-body">
        <div class="object-fields">
          <div class="info-row">
            <span class="info-label">Class</span>
            <span class="info-value font-semibold text-cyan" id="sel-class">Dynamic Vehicle</span>
          </div>
          <div class="info-row">
            <span class="info-label">Track ID</span>
            <span class="info-value font-mono" id="sel-track-id">#04</span>
          </div>
          <div class="info-row">
            <span class="info-label">Distance</span>
            <span class="info-value font-mono" id="sel-distance">32.6 m</span>
          </div>
          <div class="info-row">
            <span class="info-label">Velocity</span>
            <span class="info-value font-mono" id="sel-velocity">10.8 m/s</span>
          </div>
          <div class="info-row">
            <span class="info-label">Confidence</span>
            <span class="info-value font-mono" id="sel-confidence">91%</span>
          </div>
          <div class="info-row">
            <span class="info-label">Status</span>
            <span class="info-value" id="sel-status">Moving</span>
          </div>
        </div>

        <div class="object-preview-box" id="object-preview-box">
          <!-- Dynamic SVG Preview Container -->
        </div>
      </div>
    </div>
  `;

  const classElem = container.querySelector('#sel-class');
  const trackElem = container.querySelector('#sel-track-id');
  const distElem = container.querySelector('#sel-distance');
  const velElem = container.querySelector('#sel-velocity');
  const confElem = container.querySelector('#sel-confidence');
  const statusElem = container.querySelector('#sel-status');
  const previewBox = container.querySelector('#object-preview-box');

  function renderPreviewIcon(obj) {
    if (!obj) {
      previewBox.innerHTML = '';
      return;
    }

    const objClass = (obj.class || '').toLowerCase();
    const uiClass = (obj.ui_class || '').toLowerCase();

    if (objClass.includes('human') || uiClass.includes('human') || objClass.includes('pedestrian')) {
      // Flat 2D Technical Human Vector (Stationary Pedestrian Marker)
      previewBox.innerHTML = `
        <svg viewBox="0 0 100 120" class="preview-svg human-preview" width="65" height="80">
          <!-- Flat Orange Silhouette (No Glow / No Juices) -->
          <circle cx="50" cy="22" r="8" fill="#ea580c" stroke="#f97316" stroke-width="1.2"/>
          <path d="M 44 32 L 56 32 L 57 62 L 43 62 Z" fill="#ea580c" stroke="#f97316" stroke-width="1.2"/>
          <!-- Arms -->
          <line x1="44" y1="36" x2="36" y2="52" stroke="#ea580c" stroke-width="3.5" stroke-linecap="square"/>
          <line x1="56" y1="36" x2="64" y2="52" stroke="#ea580c" stroke-width="3.5" stroke-linecap="square"/>
          <!-- Legs (Stationary Stand) -->
          <line x1="46" y1="62" x2="43" y2="92" stroke="#ea580c" stroke-width="3.5" stroke-linecap="square"/>
          <line x1="54" y1="62" x2="57" y2="92" stroke="#ea580c" stroke-width="3.5" stroke-linecap="square"/>
          <!-- Technical 1px corner markers -->
          <path d="M 28 14 L 20 14 L 20 22 M 72 14 L 80 14 L 80 22 M 28 106 L 20 106 L 20 98 M 72 106 L 80 106 L 80 98" fill="none" stroke="#f97316" stroke-width="1"/>
        </svg>
      `;
    } else if (objClass.includes('pothole') || obj.name?.includes('POTHOLE')) {
      // Flat Technical Concentric Purple Radar Rings
      previewBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="preview-svg pothole-preview" width="70" height="70">
          <ellipse cx="50" cy="50" rx="42" ry="34" fill="rgba(168, 85, 247, 0.15)"/>
          <ellipse cx="50" cy="50" rx="40" ry="32" fill="none" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="5,3"/>
          <ellipse cx="50" cy="50" rx="28" ry="22" fill="none" stroke="#e879f9" stroke-width="1.2" stroke-dasharray="3,3"/>
          <line x1="50" y1="14" x2="50" y2="86" stroke="#c084fc" stroke-width="1" stroke-dasharray="2,2"/>
          <line x1="14" y1="50" x2="86" y2="50" stroke="#c084fc" stroke-width="1" stroke-dasharray="2,2"/>
          <circle cx="50" cy="50" r="2.5" fill="#c084fc"/>
        </svg>
      `;
    } else if (objClass.includes('pole')) {
      // Flat Red/Salmon Pole Marker
      previewBox.innerHTML = `
        <svg viewBox="0 0 100 100" class="preview-svg pole-preview" width="65" height="65">
          <circle cx="50" cy="50" r="12" fill="#ef4444" stroke="#f87171" stroke-width="1.5"/>
          <circle cx="50" cy="50" r="24" fill="none" stroke="rgba(239, 68, 68, 0.5)" stroke-width="1" stroke-dasharray="3,3"/>
          <circle cx="50" cy="50" r="3.5" fill="#ffffff"/>
        </svg>
      `;
    } else {
      // Flat 2D Technical Top-Down Vehicle Silhouette
      previewBox.innerHTML = `
        <svg viewBox="0 0 70 120" class="preview-svg vehicle-preview" width="50" height="85">
          <!-- Wheels -->
          <rect x="8" y="22" width="6" height="16" fill="#0f172a"/>
          <rect x="56" y="22" width="6" height="16" fill="#0f172a"/>
          <rect x="8" y="82" width="6" height="16" fill="#0f172a"/>
          <rect x="56" y="82" width="6" height="16" fill="#0f172a"/>
          <!-- Flat Amber Body -->
          <rect x="14" y="10" width="42" height="100" rx="3" fill="#b45309" stroke="#f59e0b" stroke-width="1.2"/>
          <!-- Windshield & Rear Window -->
          <rect x="18" y="24" width="34" height="18" fill="#070d17"/>
          <rect x="18" y="80" width="34" height="14" fill="#070d17"/>
          <!-- Technical 1px Corners -->
          <path d="M 10 6 L 6 6 L 6 14 M 60 6 L 64 6 L 64 14 M 10 114 L 6 114 L 6 106 M 60 114 L 64 114 L 64 106" fill="none" stroke="#fbbf24" stroke-width="1"/>
        </svg>
      `;
    }
  }

  return {
    update(selectedObj) {
      if (!selectedObj) return;

      if (classElem) {
        classElem.textContent = selectedObj.ui_class || 'Dynamic Vehicle';
        if (selectedObj.class === 'dynamic_human') {
          classElem.className = 'info-value font-semibold text-orange';
        } else if (selectedObj.class === 'dynamic_vehicle') {
          classElem.className = 'info-value font-semibold text-yellow';
        } else if (selectedObj.class === 'pothole') {
          classElem.className = 'info-value font-semibold text-purple';
        } else {
          classElem.className = 'info-value font-semibold text-cyan';
        }
      }

      if (trackElem) trackElem.textContent = `#${selectedObj.track_id ?? '01'}`;
      if (distElem) distElem.textContent = `${(selectedObj.distance_m || 0).toFixed(1)} m`;
      if (velElem) velElem.textContent = `${(selectedObj.velocity_mps || 0).toFixed(1)} m/s`;
      if (confElem) confElem.textContent = `${selectedObj.confidence || 90}%`;
      if (statusElem) statusElem.textContent = selectedObj.status || (selectedObj.velocity_mps > 0.1 ? 'Moving' : 'Stationary');

      renderPreviewIcon(selectedObj);
    }
  };
}
