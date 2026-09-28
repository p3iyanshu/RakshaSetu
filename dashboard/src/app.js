/**
 * RakshaSetu Vehicle Perception Dashboard Orchestrator
 * High-FPS Continuous Simulation Engine using Continuous World Odometry Projection.
 */

import { WORLD_MODEL } from './lib/worldModel.js';
import { CONFIG, onConfigChange } from './lib/config.js';
import { createHeader } from './components/Header.js?v=41';
import { createSceneInfo } from './components/SceneInfo.js?v=41';
import { createAdaptiveGridPanel } from './components/AdaptiveGridPanel.js?v=41';
import { createSemanticLegend } from './components/SemanticLegend.js?v=41';
import { createPerceptionMap } from './components/PerceptionMap.js?v=41';
import { createEventsPanel } from './components/EventsPanel.js?v=41';
import { createSelectedObject } from './components/SelectedObject.js?v=41';
import { createElevationPanel } from './components/ElevationPanel.js?v=41';
import { createMetricsBar } from './components/MetricsBar.js?v=41';
import { createAnomalyAlert } from './components/AnomalyAlert.js?v=41';

class DashboardApp {
  constructor() {
    this.distanceTraveled = 0.0; // Continuous distance traveled in meters
    this.isPaused = false;
    this.playbackSpeed = 1.0;
    this.selectedObjectId = '04';
    this.lastFrameTime = performance.now();
    this.lastEventS = -100;

    this.eventsHistory = [
      { timestamp: '17:54:08', type: 'drivable', text: 'Terrain grid initialised · 4-lane corridor', color: '#00e676' },
      { timestamp: '17:54:09', type: 'wall', text: 'Retaining wall segment mapped', color: '#ef4444' },
      { timestamp: '17:54:10', type: 'pole', text: 'Pole #11 detected', color: '#ff5252' },
      { timestamp: '17:54:11', type: 'vehicle', text: 'Vehicle #04 detected (lead)', color: '#facc15' }
    ];

    this.initComponents();
    this.start60FpsRenderLoop();

    // Admin console edits (this tab or another) land in CONFIG live; re-render
    // the panels that don't already refresh every frame.
    onConfigChange(() => {
      this.adaptiveGrid.update();
    });
  }

  initComponents() {
    // 1. Header
    this.header = createHeader(document.getElementById('header-mount'), (scenarioIdx) => {
      // Jump to the start of the chosen scenario zone on the loop
      const zone = WORLD_MODEL.scenarios[scenarioIdx] || WORLD_MODEL.scenarios[0];
      this.distanceTraveled = zone.start;
      this.lastEventS = zone.start;
    });

    // 2. Left Sidebar Panels
    this.sceneInfo = createSceneInfo(document.getElementById('scene-info-mount'));
    this.adaptiveGrid = createAdaptiveGridPanel(document.getElementById('adaptive-grid-mount'));
    this.semanticLegend = createSemanticLegend(document.getElementById('semantic-legend-mount'));

    // 3. Center Perception Map
    this.perceptionMap = createPerceptionMap(document.getElementById('map-mount'), (selectedObj) => {
      this.selectObject(selectedObj.track_id || selectedObj.id);
    });

    // Unidentified-object alert, overlaid on the perception map
    this.anomalyAlert = createAnomalyAlert(document.getElementById('map-mount'), {
      onRaise: (obj, kind) => {
        const explosive = kind === 'explosive';
        this.eventsHistory.unshift({
          timestamp: this.lastFrame?.scene.system_time || '',
          type: 'alert',
          text: explosive
            ? `EXPLOSIVE #${obj.track_id} detected · ${obj.distance_m.toFixed(0)} m · halt & keep clear`
            : `Unidentified object #${obj.track_id} · stationary · inspection recommended`,
          color: explosive ? '#ff1744' : '#ef4444'
        });
        if (explosive) this.selectObject(obj.track_id);
        if (this.eventsHistory.length > 8) this.eventsHistory.pop();
      },
      onSelect: (id) => this.selectObject(id)
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
    const frame = WORLD_MODEL.sampleAtDistance(distS);
    if (!frame) return;
    this.lastFrame = frame;

    // Update Header & Scene Info
    this.header.update(frame.scene);
    this.sceneInfo.update(frame.scene);

    // Alert first, so the map can pulse the objects that raise it
    const alertIds = this.anomalyAlert ? this.anomalyAlert.update(frame) : new Set();

    // Update Perception Map Canvas & Overlays (60fps smooth float positions)
    this.perceptionMap.update(frame, this.selectedObjectId, alertIds);

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
    const byClass = CONFIG.elevationByClass[obj.class];
    if (byClass) {
      this.elevationPanel.update({
        selected_cell_height_m: byClass.selected,
        local_terrain_height_m: byClass.terrain
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
        // Ego follows the curvature-limited speed profile, scaled by playback
        const speedMps = this.lastFrame?.scene.speed_mps ?? CONFIG.egoSpeedMps;
        this.distanceTraveled += speedMps * Math.min(deltaSec, 0.1) * this.playbackSpeed;

        // Dynamic event log trigger as vehicle passes landmarks
        if (this.distanceTraveled - this.lastEventS > 45.0) {
          this.lastEventS = this.distanceTraveled;
          this.appendLiveEvent(this.lastFrame);
        }

      }
      // Keep rendering while paused so camera moves, zoom and the LiDAR sweep stay live
      this.renderFrame(this.distanceTraveled);

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  appendLiveEvent(frame) {
    if (!frame) return;
    const time = frame.scene.system_time;
    const objs = frame.objects;
    const nearest = (cls) => objs.filter(o => o.class === cls && o.position[1] > -2).sort((a, b) => a.distance_m - b.distance_m)[0];
    let ev;
    const pothole = nearest('pothole');
    const veh = nearest('dynamic_vehicle');
    const human = nearest('dynamic_human');
    const rock = objs.filter(o => o.ui_class === 'Rockfall Debris' && o.position[1] > -2).sort((a, b) => a.distance_m - b.distance_m)[0];
    if (pothole && pothole.distance_m < 60) {
      ev = { type: 'pothole', text: `${cap(pothole.name)} ahead · ${pothole.distance_m.toFixed(0)} m (-0.22 m)`, color: '#c084fc' };
    } else if (rock && rock.distance_m < 70) {
      ev = { type: 'unclassified', text: `Rockfall debris on shoulder · ${rock.distance_m.toFixed(0)} m`, color: '#94a3b8' };
    } else if (frame.road.turn !== 'Straight' && frame.road.radius_m < 80) {
      ev = { type: 'turn', text: `${frame.road.turn} bend R ${frame.road.radius_m} m · slowing`, color: '#f97316' };
    } else if (veh && veh.distance_m < 70) {
      const dir = veh.direction === 'Oncoming' ? 'oncoming' : 'lead';
      ev = { type: 'vehicle', text: `Tracking ${cap(veh.name)} (${dir}, ${veh.velocity_mps.toFixed(1)} m/s)`, color: '#facc15' };
    } else if (human && human.distance_m < 60) {
      ev = { type: 'human', text: `${cap(human.name)} on shoulder · ${human.distance_m.toFixed(0)} m`, color: '#f97316' };
    } else {
      ev = { type: 'drivable', text: `Drivable corridor clear · grade ${frame.road.grade_pct} %`, color: '#00e676' };
    }
    this.eventsHistory.unshift({ timestamp: time, ...ev });
    if (this.eventsHistory.length > 8) this.eventsHistory.pop();
  }
}

function cap(name) {
  return name.charAt(0) + name.slice(1).toLowerCase();
}

// Start application (Handles immediate execution if document is already ready)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new DashboardApp();
  });
} else {
  window.app = new DashboardApp();
}
