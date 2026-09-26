/**
 * RakshaSetu Admin Console Orchestrator
 * Sidebar-driven: pick a vehicle from the fleet list, then switch between
 * its live Detection Panel (perception map + basic info + detection log)
 * and its Accident Records. Runs its own world-simulation instance so the
 * Detection Panel is live even without the main dashboard tab open.
 */

import { WORLD_MODEL } from './lib/worldModel.js?v=5';
import { CONFIG } from './lib/config.js?v=5';
import { VEHICLES } from './lib/vehicleRecords.js?v=5';
import { createAdminHeader } from './components/admin/AdminHeader.js?v=5';
import { createSidebar } from './components/admin/Sidebar.js?v=5';
import { createDetectionPanel } from './components/admin/DetectionPanel.js?v=5';
import { createAccidentRecords } from './components/admin/AccidentRecords.js?v=5';

class AdminApp {
  constructor() {
    this.distanceTraveled = 0.0;
    this.lastFrameTime = performance.now();
    this.selectedVehicle = VEHICLES[0];
    this.activeView = 'detection';

    this.header = createAdminHeader(document.getElementById('admin-header-mount'));
    this.sidebar = createSidebar(document.getElementById('admin-sidebar-mount'), {
      vehicles: VEHICLES,
      onSelectVehicle: (vehicle) => {
        this.selectedVehicle = vehicle;
        if (this.activeView === 'accidents') this.accidentRecords?.update(this.selectedVehicle);
      },
      onNavChange: (view) => {
        this.activeView = view;
        this.mountActiveView();
      }
    });

    this.contentMount = document.getElementById('admin-content-mount');
    this.detectionPanel = null;
    this.accidentRecords = null;
    this.mountActiveView();

    this.startRenderLoop();
  }

  mountActiveView() {
    this.detectionPanel?.destroy?.();
    this.contentMount.innerHTML = '';
    this.detectionPanel = null;
    this.accidentRecords = null;

    if (this.activeView === 'accidents') {
      this.accidentRecords = createAccidentRecords(this.contentMount);
      this.accidentRecords.update(this.selectedVehicle);
    } else {
      this.detectionPanel = createDetectionPanel(this.contentMount);
    }
  }

  startRenderLoop() {
    const loop = (now) => {
      const deltaSec = (now - this.lastFrameTime) / 1000.0;
      this.lastFrameTime = now;
      this.distanceTraveled += CONFIG.egoSpeedMps * deltaSec;

      const frame = WORLD_MODEL.sampleAtDistance(this.distanceTraveled, now / 1000.0);
      this.header.update(frame.scene);
      if (this.activeView === 'detection' && this.detectionPanel) {
        this.detectionPanel.update(frame, this.selectedVehicle);
      }

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
