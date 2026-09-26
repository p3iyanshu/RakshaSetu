/**
 * Admin Console — Detection Panel
 * Basic vehicle information, interactive Grid Comparison (Adaptive vs. Uniform),
 * the live LiDAR point-cloud feed with live grid mode switching, and a detection log.
 */

import { createLidarFeedPanel } from './LidarFeedPanel.js?v=5';
import { createGridComparisonPanel } from './GridComparisonPanel.js?v=5';

export function createDetectionPanel(container) {
  container.innerHTML = `
    <div class="admin-detection-grid">
      <div class="admin-detection-left">
        <!-- 1. Basic Vehicle Information -->
        <div class="rs-card admin-basic-info-card">
          <div class="card-header">
            <h2 class="card-title">BASIC INFORMATION</h2>
          </div>
          <div class="card-body" id="admin-basic-info-body"></div>
        </div>

        <!-- 2. Grid Comparison Panel (Adaptive vs. Uniform) -->
        <div id="admin-grid-comparison-mount"></div>

        <!-- 3. Detection Log -->
        <div class="rs-card admin-log-card">
          <div class="card-header">
            <h2 class="card-title">DETECTION LOG</h2>
          </div>
          <div class="card-body admin-event-list" id="admin-detection-log"></div>
        </div>
      </div>

      <!-- Live LiDAR Feed -->
      <div class="admin-map-card" id="admin-lidar-feed-mount"></div>
    </div>
  `;

  const basicInfoElem = container.querySelector('#admin-basic-info-body');
  const logElem = container.querySelector('#admin-detection-log');
  const lidarFeedMount = container.querySelector('#admin-lidar-feed-mount');
  const gridCompMount = container.querySelector('#admin-grid-comparison-mount');

  const lidarFeed = createLidarFeedPanel(lidarFeedMount);

  let previousTrackIds = new Set();
  const events = [];

  function pushEvent(text, color) {
    events.unshift({ time: new Date().toLocaleTimeString('en-GB'), text, color });
    if (events.length > 10) events.pop();
    logElem.innerHTML = events
      .map(
        (e) => `
        <div class="admin-event-row">
          <span class="admin-event-time font-mono">${e.time}</span>
          <span class="admin-event-dot" style="background:${e.color}"></span>
          <span class="admin-event-text">${e.text}</span>
        </div>`
      )
      .join('');
  }

  // Connect Grid Comparison to the Live LiDAR feed
  const gridComparison = createGridComparisonPanel(gridCompMount, (mode) => {
    lidarFeed.setGridMode(mode);
    pushEvent(
      `Grid switched to ${mode.toUpperCase()} mode (${mode === 'uniform' ? '1.2M cells · Laggy 8 FPS · 74ms' : '444K cells · Smooth 42 FPS · 24ms'})`,
      mode === 'uniform' ? '#ef4444' : '#00f2fe'
    );
  });

  return {
    update(frame, vehicle) {
      if (!frame || !vehicle) return;

      const liveObj = vehicle.trackId
        ? frame.objects.find((o) => String(o.track_id) === String(vehicle.trackId))
        : null;

      basicInfoElem.innerHTML = `
        <div class="info-row">
          <span class="info-label">Vehicle Number</span>
          <span class="info-value font-mono">${vehicle.vehicleNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Make / Model</span>
          <span class="info-value">${vehicle.make}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Color</span>
          <span class="info-value">${vehicle.color}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Status</span>
          <span class="info-value ${liveObj ? 'text-cyan' : 'text-muted'}">
            ${liveObj ? 'LIVE — IN PERCEPTION RANGE' : 'NOT CURRENTLY DETECTED'}
          </span>
        </div>
        ${
          liveObj
            ? `
        <div class="info-row"><span class="info-label">Track ID</span><span class="info-value font-mono">#${liveObj.track_id}</span></div>
        <div class="info-row"><span class="info-label">Position (x, y)</span><span class="info-value font-mono">${liveObj.position[0]}, ${liveObj.position[1]}</span></div>
        <div class="info-row"><span class="info-label">Distance</span><span class="info-value font-mono">${liveObj.distance_m} m</span></div>
        <div class="info-row"><span class="info-label">Velocity</span><span class="info-value font-mono">${liveObj.velocity_mps.toFixed(1)} m/s</span></div>
        <div class="info-row"><span class="info-label">Confidence</span><span class="info-value font-mono">${liveObj.confidence}%</span></div>
        `
            : `<div class="admin-empty-state">This vehicle is outside the current perception field, so no live data points exist for it right now.</div>`
        }
        <div class="info-row">
          <span class="info-label">Accident History</span>
          <span class="info-value ${vehicle.accidents.length ? 'text-orange' : 'text-cyan'}">
            ${vehicle.accidents.length} record${vehicle.accidents.length === 1 ? '' : 's'}
          </span>
        </div>
      `;

      gridComparison.update(frame);
      lidarFeed.update(frame);

      const currentIds = new Set(frame.objects.map((o) => String(o.track_id)));
      frame.objects.forEach((o) => {
        if (!previousTrackIds.has(String(o.track_id))) {
          pushEvent(`${o.ui_class || o.class} #${o.track_id} detected`, o.is_dynamic ? '#facc15' : '#00e676');
        }
      });
      previousTrackIds = currentIds;
    },
    destroy() {
      lidarFeed.destroy();
    }
  };
}
