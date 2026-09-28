/**
 * Admin Console — Basic Information
 * Live telemetry of the selected fleet vehicle (the one driving the loop):
 * identity, status, zone, speed, heading, lane, position, altitude/grade,
 * trip distance, objects tracked and accident history. Lives in the sidebar
 * under the fleet dropdown and updates every frame in every view.
 */

export function createBasicInfoPanel(container) {
  container.innerHTML = `
    <div class="rs-card admin-basic-info-card">
      <div class="card-header">
        <h2 class="card-title">BASIC INFORMATION</h2>
      </div>
      <div class="card-body" id="admin-basic-info-body"></div>
    </div>
  `;
  const body = container.querySelector('#admin-basic-info-body');

  const row = (label, value, cls = '') =>
    `<div class="info-row"><span class="info-label">${label}</span><span class="info-value ${cls}">${value}</span></div>`;

  return {
    update(frame, vehicle, { tripMeters = 0 } = {}) {
      if (!frame || !vehicle) return;
      const onRoad = vehicle.status === 'ON ROAD';
      const sc = frame.scene;
      const html = `
        ${row('Vehicle Number', vehicle.vehicleNumber, 'font-mono')}
        ${row('Make / Model', vehicle.make)}
        ${row('Color', vehicle.color)}
        ${row('Status', onRoad ? 'ON ROAD · LIVE' : 'PARKED', onRoad ? 'text-green' : 'text-muted')}
        <div class="info-divider"></div>
        ${row('Scenario / Zone', sc.scenario)}
        ${row('Speed', onRoad ? `${sc.speed_kmh.toFixed(1)} km/h` : '0.0 km/h', 'font-mono')}
        ${row('Heading', `${sc.heading_deg.toFixed(1)}° (${sc.heading_cardinal})`, 'font-mono')}
        ${row('Lane', frame.road.lane)}
        ${row('Position (x, y)', `(${sc.position[0].toFixed(1)}, ${sc.position[1].toFixed(1)}) m`, 'font-mono')}
        ${row('Altitude / Grade', `${sc.altitude_m} m · ${sc.grade_pct >= 0 ? '+' : ''}${sc.grade_pct.toFixed(1)} %`, 'font-mono')}
        ${row('Trip Distance', `${(tripMeters / 1000).toFixed(2)} km`, 'font-mono')}
        ${row('Objects Tracked', `${frame.objects.length} (${frame.objects.filter(o => o.is_dynamic).length} moving)`, 'font-mono')}
        ${row('Accident History', `${vehicle.accidents.length} record${vehicle.accidents.length === 1 ? '' : 's'}`,
              vehicle.accidents.length ? 'text-orange' : 'text-cyan')}
      `;
      // Only touch the DOM when the content actually changes
      if (html !== body._html) {
        body.innerHTML = html;
        body._html = html;
      }
    }
  };
}
