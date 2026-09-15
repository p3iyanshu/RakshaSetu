/**
 * RakshaSetu Admin Console Orchestrator
 * Runs its own instance of the deterministic world simulation (so the
 * monitoring view is live even without the main dashboard tab open) and
 * hosts the editable configuration forms.
 */

import { WORLD_MODEL } from './lib/worldModel.js';
import { CONFIG, onConfigChange } from './lib/config.js';
import { createAdminHeader } from './components/admin/AdminHeader.js';
import { createMonitoringPanel } from './components/admin/MonitoringPanel.js';
import { createConfigPanel } from './components/admin/ConfigPanel.js';

class AdminApp {
  constructor() {
    this.distanceTraveled = 0.0;
    this.lastFrameTime = performance.now();

    this.header = createAdminHeader(document.getElementById('admin-header-mount'));
    this.monitoring = createMonitoringPanel(document.getElementById('monitoring-mount'));
    this.configPanel = createConfigPanel(document.getElementById('config-mount'));

    // Reflect edits made in this tab or synced in from another tab.
    onConfigChange(() => this.configPanel.refresh());

    this.renderFrame(0.0);
    this.startRenderLoop();
  }

  renderFrame(distS) {
    const frame = WORLD_MODEL.sampleAtDistance(distS, performance.now() / 1000.0);
    if (!frame) return;
    this.header.update(frame.scene);
    this.monitoring.update(frame);
  }

  startRenderLoop() {
    const loop = (now) => {
      const deltaSec = (now - this.lastFrameTime) / 1000.0;
      this.lastFrameTime = now;
      this.distanceTraveled += CONFIG.egoSpeedMps * deltaSec;
      this.renderFrame(this.distanceTraveled);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
  });
} else {
  window.adminApp = new AdminApp();
}
