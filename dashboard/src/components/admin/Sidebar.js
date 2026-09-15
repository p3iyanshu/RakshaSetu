/**
 * Admin Console Sidebar — fleet vehicle search/select, and navigation
 * between the Detection Panel and Accident Records views for whichever
 * vehicle is selected.
 */

export function createSidebar(container, { vehicles, onSelectVehicle, onNavChange }) {
  container.innerHTML = `
    <div class="rs-card admin-fleet-card">
      <div class="card-header">
        <h2 class="card-title">FLEET</h2>
      </div>
      <div class="card-body admin-fleet-body">
        <input
          type="text"
          id="vehicle-search"
          class="admin-search-input"
          placeholder="Search vehicle number..."
          autocomplete="off"
        />
        <div class="admin-vehicle-list" id="admin-vehicle-list"></div>
      </div>
    </div>

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

  const searchInput = container.querySelector('#vehicle-search');
  const listElem = container.querySelector('#admin-vehicle-list');
  const navButtons = [...container.querySelectorAll('.admin-nav-btn')];

  let selectedVehicleNumber = vehicles[0]?.vehicleNumber;

  function renderList(filterText = '') {
    const q = filterText.trim().toLowerCase();
    const filtered = vehicles.filter((v) => v.vehicleNumber.toLowerCase().includes(q));
    listElem.innerHTML = filtered
      .map(
        (v) => `
      <button
        class="admin-vehicle-row ${v.vehicleNumber === selectedVehicleNumber ? 'selected' : ''}"
        data-vehicle="${v.vehicleNumber}"
      >
        <span class="admin-vehicle-number font-mono">${v.vehicleNumber}</span>
        <span class="admin-vehicle-make">${v.make}</span>
        <span class="admin-vehicle-badge ${v.trackId ? 'live' : 'offline'}">
          ${v.trackId ? 'LIVE-TRACKED' : 'NOT IN RANGE'}
        </span>
      </button>`
      )
      .join('') || `<div class="admin-empty-state">No vehicles match "${filterText}".</div>`;

    listElem.querySelectorAll('.admin-vehicle-row').forEach((row) => {
      row.addEventListener('click', () => {
        selectedVehicleNumber = row.dataset.vehicle;
        renderList(searchInput.value);
        const vehicle = vehicles.find((v) => v.vehicleNumber === selectedVehicleNumber);
        if (onSelectVehicle) onSelectVehicle(vehicle);
      });
    });
  }

  renderList();

  searchInput.addEventListener('input', () => renderList(searchInput.value));

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (onNavChange) onNavChange(btn.dataset.view);
    });
  });

  return {
    getSelectedVehicle() {
      return vehicles.find((v) => v.vehicleNumber === selectedVehicleNumber);
    }
  };
}
