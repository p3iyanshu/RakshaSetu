/**
 * RakshaSetu Vehicle Perception Dashboard Orchestrator
 * High-FPS Continuous Simulation Engine using Continuous World Odometry Projection.
 */

import { WORLD_MODEL } from './lib/worldModel.js';
import { createHeader } from './components/Header.js';
import { createSceneInfo } from './components/SceneInfo.js';
import { createAdaptiveGridPanel } from './components/AdaptiveGridPanel.js';
import { createSemanticLegend } from './components/SemanticLegend.js';
import { createPerceptionMap } from './components/PerceptionMap.js';
import { createEventsPanel } from './components/EventsPanel.js';
import { createSelectedObject } from './components/SelectedObject.js';
import { createElevationPanel } from './components/ElevationPanel.js';
import { createMetricsBar } from './components/MetricsBar.js';

class DashboardApp {
  constructor() {
    this.distanceTraveled = 0.0; // Continuous distance traveled in meters
    this.isPaused = false;
    this.playbackSpeed = 1.0;
    this.selectedObjectId = '04';
    this.lastFrameTime = performance.now();
    this.lastEventS = -100;

    this.eventsHistory = [
      { timestamp: '17:54:18', type: 'vehicle', text: 'Vehicle #04 detected', color: '#00e676' },
      { timestamp: '17:54:19', type: 'pole', text: 'Pole #11 detected', color: '#a3e635' },
      { timestamp: '17:54:20', type: 'drivable', text: 'Drivable area updated', color: '#00e676' },
      { timestamp: '17:54:20', type: 'human', text: 'Human #12 detected', color: '#ef4444' },
      { timestamp: '17:54:21', type: 'wall', text: 'Static wall detected', color: '#f97316' }
    ];

    this.initComponents();
    this.start60FpsRenderLoop();
  }

  initComponents() {
    // 1. Header
    this.header = createHeader(document.getElementById('header-mount'), (scenarioIdx) => {
      // Jump distance directly to corresponding landmark
      const targetDistances = [0.0, 195.0, 105.0, 265.0];
      this.distanceTraveled = targetDistances[scenarioIdx] || 0.0;
    });

    // 2. Left Sidebar Panels
    this.sceneInfo = createSceneInfo(document.getElementById('scene-info-mount'));
    this.adaptiveGrid = createAdaptiveGridPanel(document.getElementById('adaptive-grid-mount'));
    this.semanticLegend = createSemanticLegend(document.getElementById('semantic-legend-mount'));

    // 3. Center Perception Map
    this.perceptionMap = createPerceptionMap(document.getElementById('map-mount'), (selectedObj) => {
      this.selectObject(selectedObj.track_id || selectedObj.id);
    });

    // 4. Right Sidebar Panels
    this.eventsPanel = createEventsPanel(document.getElementById('events-mount'));
    this.selectedObject = createSelectedObject(document.getElementById('selected-object-mount'));
    this.elevationPanel = createElevationPanel(document.getElementById('elevation-mount'));

    // 5. Bottom Metrics Bar
    this.metricsBar = createMetricsBar(document.getElementById('metrics-mount'), {
      onTogglePause: (paused) => {
        this.isPaused = paused;
      },
      onRestart: () => {
        this.distanceTraveled = 0.0;
        this.isPaused = false;
        this.metricsBar.setPaused(false);
      },
      onSpeedChange: (speed) => {
        this.playbackSpeed = speed;
      }
    });

    // Initial render
    this.renderFrame(0.0);
  }

  selectObject(objectId) {
    this.selectedObjectId = String(objectId);
  }

  renderFrame(distS) {
    const frame = WORLD_MODEL.sampleAtDistance(distS, performance.now() / 1000.0);
    if (!frame) return;

    // Update Header & Scene Info
    this.header.update(frame.scene);
    this.sceneInfo.update(frame.scene);

    // Update Perception Map Canvas & Overlays (60fps smooth float positions)
    this.perceptionMap.update(frame, this.selectedObjectId);

    // Update Selected Object
    const currentSel = frame.objects.find(o => String(o.track_id) === String(this.selectedObjectId)) 
      || frame.objects[0];
    if (currentSel) {
      this.selectedObject.update(currentSel);
      this.updateElevationForObject(currentSel, frame.elevation);
    }

    // Update Events & Metrics
    this.eventsPanel.update(this.eventsHistory);
    this.metricsBar.update(frame.metrics);
  }

  updateElevationForObject(obj, defaultElev) {
    if (!obj) return;
    if (obj.class === 'pothole') {
      this.elevationPanel.update({
        selected_cell_height_m: -0.22,
        local_terrain_height_m: -0.18
      });
    } else if (obj.class === 'dynamic_vehicle') {
      this.elevationPanel.update({
        selected_cell_height_m: 0.12,
        local_terrain_height_m: 0.03
      });
    } else if (obj.class === 'dynamic_human') {
      this.elevationPanel.update({
        selected_cell_height_m: 0.05,
        local_terrain_height_m: 0.03
      });
    } else if (obj.class === 'static_wall') {
      this.elevationPanel.update({
        selected_cell_height_m: 1.20,
        local_terrain_height_m: 0.05
      });
    } else if (obj.class === 'static_pole') {
      this.elevationPanel.update({
        selected_cell_height_m: 0.95,
        local_terrain_height_m: 0.04
      });
    } else {
      this.elevationPanel.update(defaultElev);
    }
  }

  start60FpsRenderLoop() {
    const loop = (now) => {
      const deltaSec = (now - this.lastFrameTime) / 1000.0;
      this.lastFrameTime = now;

      if (!this.isPaused) {
        // Speed in m/s (20 km/h ~ 5.5 m/s)
        const speedMps = 5.8;
        this.distanceTraveled += speedMps * deltaSec * this.playbackSpeed;

        // Dynamic event log trigger as vehicle passes landmarks
        if (this.distanceTraveled - this.lastEventS > 35.0) {
          this.lastEventS = this.distanceTraveled;
          this.appendLiveEvent(this.distanceTraveled);
        }

        // Render at 60 FPS
        this.renderFrame(this.distanceTraveled);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  appendLiveEvent(s) {
    const loopS = ((s % WORLD_MODEL.totalLength) + WORLD_MODEL.totalLength) % WORLD_MODEL.totalLength;
    const timeFormatted = `17:55:${String(Math.floor(12 + (loopS * 0.2) % 48)).padStart(2, '0')}`;
    let newEvent = null;

    if (loopS < 85) {
      newEvent = { timestamp: timeFormatted, type: 'vehicle', text: 'Tracking #04 (10.8 m/s)', color: '#00e676' };
    } else if (loopS < 165) {
      newEvent = { timestamp: timeFormatted, type: 'pothole', text: 'Pothole #21 detected (-0.22m)', color: '#c084fc' };
    } else if (loopS < 255) {
      newEvent = { timestamp: timeFormatted, type: 'turn', text: 'Left turn in progress (-41.7°)', color: '#f97316' };
    } else {
      newEvent = { timestamp: timeFormatted, type: 'drivable', text: 'Forward trajectory clear', color: '#00e676' };
    }

    if (newEvent) {
      this.eventsHistory.unshift(newEvent);
      if (this.eventsHistory.length > 8) {
        this.eventsHistory.pop();
      }
    }
  }
}

// Start application (Handles immediate execution if document is already ready)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new DashboardApp();
  });
} else {
  window.app = new DashboardApp();
}
