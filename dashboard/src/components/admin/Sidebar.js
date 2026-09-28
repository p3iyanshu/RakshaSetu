/**
 * Admin Console Sidebar — fleet vehicle dropdown (searchable, keyboard
 * accessible), a fleet status summary, the selected vehicle's Basic
 * Information (mounted by admin.js), and navigation between the Detection
 * Panel and Accident Records views for whichever vehicle is selected.
 */

function badge(v) {
  const onRoad = v.status === 'ON ROAD';
  return `<span class="admin-vehicle-badge ${onRoad ? 'live' : 'offline'}">${onRoad ? 'ON ROAD · LIVE' : 'PARKED'}</span>`;
}

export function createSidebar(container, { vehicles, onSelectVehicle, onNavChange }) {
  const onRoad = vehicles.filter((v) => v.status === 'ON ROAD').length;

  container.innerHTML = `
    <div class="rs-card admin-fleet-card">
      <div class="card-header">
        <h2 class="card-title">FLEET</h2>
      </div>
      <div class="card-body admin-fleet-body">
        <div class="fleet-dd">
          <button type="button" class="fleet-dd-toggle" id="fleet-dd-toggle"
                  aria-haspopup="listbox" aria-expanded="false" aria-controls="fleet-dd-panel">
            <span class="fleet-dd-current" id="fleet-dd-current"></span>
            <span class="fleet-dd-caret" aria-hidden="true">▾</span>
          </button>
          <div class="fleet-dd-panel" id="fleet-dd-panel" hidden>
            <input type="text" class="admin-search-input" id="vehicle-search"
                   placeholder="Search vehicle number..." autocomplete="off" aria-label="Search vehicles" />
            <div class="fleet-dd-list" id="fleet-dd-list" role="listbox" aria-label="Fleet vehicles"></div>
          </div>
        </div>

        <div class="fleet-summary">
          <div class="fleet-summary-item">
            <span class="fleet-summary-value text-green font-mono">${onRoad}</span>
            <span class="fleet-summary-label">On road</span>
          </div>
          <div class="fleet-summary-item">
            <span class="fleet-summary-value font-mono">${vehicles.length - onRoad}</span>
            <span class="fleet-summary-label">Parked</span>
          </div>
          <div class="fleet-summary-item">
            <span class="fleet-summary-value font-mono">${vehicles.length}</span>
            <span class="fleet-summary-label">Total</span>
          </div>
        </div>
      </div>
    </div>

    <div id="admin-basic-info-mount" class="admin-basic-info-mount"></div>

    <div class="rs-card admin-nav-card">
      <div class="card-header">
        <h2 class="card-title">VIEW</h2>
      </div>
      <div class="card-body admin-nav-body">
        <button class="admin-nav-btn active" data-view="detection">Detection Panel</button>
        <button class="admin-nav-btn" data-view="accidents">Accident Records</button>
      </div>
    </div>
  `;

  const toggle = container.querySelector('#fleet-dd-toggle');
  const current = container.querySelector('#fleet-dd-current');
  const panel = container.querySelector('#fleet-dd-panel');
  const searchInput = container.querySelector('#vehicle-search');
  const listElem = container.querySelector('#fleet-dd-list');
  const navButtons = [...container.querySelectorAll('.admin-nav-btn')];

  let selectedVehicleNumber = vehicles[0]?.vehicleNumber;
  let activeIndex = 0;     // keyboard-highlighted option
  let filtered = vehicles;

  function renderCurrent() {
    const v = vehicles.find((x) => x.vehicleNumber === selectedVehicleNumber);
    if (!v) return;
    current.innerHTML = `
      <span class="admin-vehicle-number font-mono">${v.vehicleNumber}</span>
      <span class="admin-vehicle-make">${v.make}</span>
      ${badge(v)}`;
  }

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    filtered = vehicles.filter((v) =>
      v.vehicleNumber.toLowerCase().includes(q) || v.make.toLowerCase().includes(q));
    activeIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    listElem.innerHTML = filtered.length
      ? filtered.map((v, i) => `
        <div class="fleet-dd-option ${i === activeIndex ? 'active' : ''}"
             role="option" id="fleet-opt-${i}" data-vehicle="${v.vehicleNumber}"
             aria-selected="${v.vehicleNumber === selectedVehicleNumber}">
          <span class="fleet-dd-option-main">
            <span class="admin-vehicle-number font-mono">${v.vehicleNumber}</span>
            <span class="admin-vehicle-make">${v.make}</span>
          </span>
          ${badge(v)}
        </div>`).join('')
      : `<div class="admin-empty-state">No vehicles match "${searchInput.value}".</div>`;
    if (filtered.length) toggle.setAttribute('aria-activedescendant', `fleet-opt-${activeIndex}`);
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    container.querySelector('.fleet-dd').classList.add('open');
    activeIndex = Math.max(0, vehicles.findIndex((v) => v.vehicleNumber === selectedVehicleNumber));
    searchInput.value = '';
    renderList();
    searchInput.focus();
  }

  function close(returnFocus = false) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    container.querySelector('.fleet-dd').classList.remove('open');
    if (returnFocus) toggle.focus();
  }

  function choose(vehicleNumber) {
    selectedVehicleNumber = vehicleNumber;
    renderCurrent();
    close(true);
    const vehicle = vehicles.find((v) => v.vehicleNumber === vehicleNumber);
    if (onSelectVehicle) onSelectVehicle(vehicle);
  }

  toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
  listElem.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-vehicle]');
    if (opt) choose(opt.dataset.vehicle);
  });
  searchInput.addEventListener('input', () => { activeIndex = 0; renderList(); });

  // Keyboard: arrows move, Enter picks, Esc closes
  const onKey = (e) => {
    if (panel.hidden) {
      if (e.target === toggle && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(filtered.length - 1, activeIndex + 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); renderList(); }
    else if (e.key === 'Enter' && filtered[activeIndex]) { e.preventDefault(); choose(filtered[activeIndex].vehicleNumber); }
  };
  container.addEventListener('keydown', onKey);

  // Click outside closes
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !container.querySelector('.fleet-dd').contains(e.target)) close();
  });

  renderCurrent();

  function setView(view) {
    navButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (onNavChange) onNavChange(view);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  return {
    setView,
    getSelectedVehicle() {
      return vehicles.find((v) => v.vehicleNumber === selectedVehicleNumber);
    }
  };
}
