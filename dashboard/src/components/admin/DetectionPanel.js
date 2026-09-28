/**
 * Admin Console — Detection Panel
 * Interactive Grid Comparison (Adaptive vs. Uniform), the live LiDAR
 * point-cloud feed with live grid mode switching, and a detection log.
 * (Basic vehicle information lives in the sidebar — see BasicInfoPanel.)
 */

import { createLidarFeedPanel } from './LidarFeedPanel.js?v=32';
import { createGridComparisonPanel } from './GridComparisonPanel.js?v=32';

export function createDetectionPanel(container) {
  container.innerHTML = `
    <div class="admin-detection-grid">
      <div class="admin-detection-left">
        <!-- 1. Grid Comparison Panel (Adaptive vs. Uniform) -->
        <div id="admin-grid-comparison-mount"></div>

        <!-- 2. Detection Log -->
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

  const logElem = container.querySelector('#admin-detection-log');
  const lidarFeedMount = container.querySelector('#admin-lidar-feed-mount');
  const gridCompMount = container.querySelector('#admin-grid-comparison-mount');

  const lidarFeed = createLidarFeedPanel(lidarFeedMount);

  let previousTrackIds = new Set();
  let lastVehicle = null;
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
      const onRoad = vehicle.status === 'ON ROAD';

      // A new vehicle means a new viewpoint: snap the feed camera and restart the log
      if (vehicle !== lastVehicle) {
        lastVehicle = vehicle;
        lidarFeed.resetView();
        previousTrackIds = new Set();
        pushEvent(`Feed switched to ${vehicle.vehicleNumber} (${onRoad ? 'on road' : 'parked'})`, '#00f2fe');
      }
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
