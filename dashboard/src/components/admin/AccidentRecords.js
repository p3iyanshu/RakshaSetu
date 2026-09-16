/**
 * Admin Console — Accident Records view
 * Past accident history for the vehicle currently selected in the sidebar,
 * including cause of accident, severity, and location.
 */

export function createAccidentRecords(container) {
  return {
    update(vehicle) {
      if (!vehicle) return;

      const rows = vehicle.accidents.length
        ? vehicle.accidents
            .map(
              (a) => `
        <div class="admin-accident-row">
          <div class="admin-accident-date font-mono">${a.date}</div>
          <div class="admin-accident-body">
            <div class="admin-accident-cause">${a.cause}</div>
            <div class="admin-accident-meta">
              <span class="admin-severity-badge severity-${a.severity.toLowerCase()}">${a.severity}</span>
              <span class="admin-accident-location">${a.location}</span>
            </div>
          </div>
        </div>`
            )
            .join('')
        : `<div class="admin-empty-state">No accident records on file for ${vehicle.vehicleNumber}.</div>`;

      container.innerHTML = `
        <div class="rs-card admin-accidents-card">
          <div class="card-header">
            <h2 class="card-title">ACCIDENT RECORDS — ${vehicle.vehicleNumber}</h2>
          </div>
          <div class="card-body admin-accidents-body">${rows}</div>
        </div>
      `;
    }
  };
}
