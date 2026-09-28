/**
 * RakshaSetu Admin Console Orchestrator
 * Sidebar-driven: pick a vehicle from the fleet list, then switch between
 * its live Detection Panel (perception map + basic info + detection log)
 * and its Accident Records. Runs its own world-simulation instance so the
 * Detection Panel is live even without the main dashboard tab open.
 */

import { WORLD_MODEL } from './lib/worldModel.js';
import { VEHICLES } from './lib/vehicleRecords.js?v=32';
import { createAdminHeader } from './components/admin/AdminHeader.js?v=32';
import { createSidebar } from './components/admin/Sidebar.js?v=35';
import { createDetectionPanel } from './components/admin/DetectionPanel.js?v=34';
import { createAccidentRecords } from './components/admin/AccidentRecords.js?v=32';
import { createBasicInfoPanel } from './components/admin/BasicInfoPanel.js?v=36';

class AdminApp {
  constructor() {
    // Each fleet vehicle keeps its own position on the loop; parked ones never move
    this.tripMeters = new Map(VEHICLES.map((v) => [v.vehicleNumber, 0]));
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

    this.basicInfo = createBasicInfoPanel(document.getElementById('admin-basic-info-mount'), {
      onOpenAccidents: () => this.sidebar.setView('accidents')
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
      const dt = Math.min(deltaSec, 0.1);
      // On-road vehicles drive the same curvature-limited speed profile as the main dashboard
      for (const v of VEHICLES) {
        if (v.status !== 'ON ROAD') continue;
        const s = v.routeOffsetM + this.tripMeters.get(v.vehicleNumber);
        this.tripMeters.set(v.vehicleNumber, this.tripMeters.get(v.vehicleNumber) + WORLD_MODEL.speedAt(s) * dt);
      }

      const v = this.selectedVehicle;
      const trip = this.tripMeters.get(v.vehicleNumber);
      const frame = WORLD_MODEL.sampleAtDistance(v.routeOffsetM + trip);
      this.header.update(frame.scene);
      this.basicInfo.update(frame, v, { tripMeters: trip });
      if (this.activeView === 'detection' && this.detectionPanel) {
        this.detectionPanel.update(frame, v);
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
