/**
 * World Map Model & Technical LiDAR Perception Dynamics for RakshaSetu
 * SIH PS 26053 · DRDO
 *
 * Implements:
 * FIX 3: Dynamic proximity-based lateral lane discipline (ego shifts smoothly when vehicles approach within 20m).
 * FIX 4: Only vehicles are dynamic. Humans, poles, walls, and potholes are strictly STATIC (frozen positions, 0.0 m/s).
 */

export class WorldModel {
  constructor() {
    this.totalLength = 320.0; // 320 meters track

    // Fixed Static Infrastructure & Static Pedestrians (Strictly stationary on sidewalk sides of the road)
    this.staticObjects = [
      // Section 1: Urban Straight Drive
      // Pole #11 on Left Sidewalk (x=-7.0m)
      { track_id: '11', name: 'POLE #11', class: 'static_pole', ui_class: 'Static Pole', stationS: 36.0, lateralOffset: -7.0, confidence: 0.95, is_dynamic: false },
      // Human #12 on Left Sidewalk (x=-5.8m, velocity 0.0 m/s)
      { track_id: '12', name: 'HUMAN #12', class: 'dynamic_human', ui_class: 'Dynamic Human', stationS: 55.0, lateralOffset: -5.8, confidence: 0.91, is_dynamic: false },
      // Pole #09 on Right Sidewalk (x=+7.2m)
      { track_id: '09', name: 'POLE #09', class: 'static_pole', ui_class: 'Static Pole', stationS: 62.0, lateralOffset: 7.2, confidence: 0.94, is_dynamic: false },
      // Left Wall Boundary (x=-10.8m)
      { track_id: 'wall_1', name: 'WALL', class: 'static_wall', ui_class: 'Static Wall', stationS: 42.0, lateralOffset: -10.8, confidence: 0.98, is_dynamic: false },

      // Section 2: Pothole & Curb Section
      // Pole #14 on Left Sidewalk (x=-7.0m)
      { track_id: '14', name: 'POLE #14', class: 'static_pole', ui_class: 'Static Pole', stationS: 88.0, lateralOffset: -7.0, confidence: 0.96, is_dynamic: false },
      // Human #19 on Right Sidewalk (x=+5.5m, velocity 0.0 m/s)
      { track_id: '19', name: 'HUMAN #19', class: 'dynamic_human', ui_class: 'Dynamic Human', stationS: 105.0, lateralOffset: 5.5, confidence: 0.89, is_dynamic: false },
      // Pothole #21 in Right Lane (x=+2.0m)
      { track_id: '21', name: 'POTHOLE #21', class: 'pothole', ui_class: 'Static Obstacle', stationS: 120.0, lateralOffset: 2.0, radius: 2.0, confidence: 0.93, is_dynamic: false },
      // Pole #17 on Right Sidewalk (x=+7.2m)
      { track_id: '17', name: 'POLE #17', class: 'static_pole', ui_class: 'Static Pole', stationS: 126.0, lateralOffset: 7.2, confidence: 0.95, is_dynamic: false },
      // Curb Tag on Right Barrier (x=+5.8m)
      { track_id: 'curb', name: 'CURB', class: 'curb', ui_class: 'Curb', stationS: 130.0, lateralOffset: 5.8, confidence: 0.96, is_dynamic: false },

      // Section 3: Left Turn Intersection
      // Pole #22 on Left Sidewalk (x=-7.0m)
      { track_id: '22', name: 'POLE #22', class: 'static_pole', ui_class: 'Static Pole', stationS: 172.0, lateralOffset: -7.0, confidence: 0.95, is_dynamic: false },
      // Human #23: Frozen on right sidewalk near corner (x=+5.2m, velocity 0.0 m/s)
      { track_id: '23', name: 'HUMAN #23', class: 'dynamic_human', ui_class: 'Dynamic Human', stationS: 212.0, lateralOffset: 5.2, confidence: 0.85, is_dynamic: false },
      // Corner Wall Tag (x=-10.8m)
      { track_id: 'wall_turn', name: 'WALL', class: 'static_wall', ui_class: 'Static Wall', stationS: 238.0, lateralOffset: -10.8, confidence: 0.98, is_dynamic: false }
    ];

    // Dynamic Traffic (ONLY VEHICLES MOVE)
    this.dynamicVehicles = [
      // VEHICLE #04: In Right-Center Lane (x=+1.6m), cruising slower (4.2 m/s) so Ego smoothly catches up, maneuvers around/passes it by, and leaves it behind
      {
        track_id: '04',
        name: 'VEHICLE #04',
        class: 'dynamic_vehicle',
        speedMps: 4.2,
        startPos: [1.6, 28.0],
        activeRange: [0, 120],
        confidence: 0.93,
        bbox: { l: 4.4, w: 1.9, h: 1.5 }
      },
      // VEHICLE #18: Lead vehicle in Left Lane (x=-3.2m) during pothole section
      {
        track_id: '18',
        name: 'VEHICLE #18',
        class: 'dynamic_vehicle',
        speedMps: 5.5,
        startPos: [-3.2, 138.0],
        activeRange: [75, 175],
        confidence: 0.88,
        bbox: { l: 4.4, w: 1.9, h: 1.5 }
      },
      // VEHICLE #26: Oncoming vehicle navigating adjacent lane in intersection
      {
        track_id: '26',
        name: 'VEHICLE #26',
        class: 'dynamic_vehicle',
        speedMps: 8.8,
        startPos: [-18.0, 235.0],
        activeRange: [155, 285],
        confidence: 0.92,
        bbox: { l: 4.4, w: 1.9, h: 1.5 }
      }
    ];

    this.currentLateralBias = 0.0; // Smoothed lateral lane bias
  }

  /**
   * Road Centerline and heading at distance s
   */
  getRoadCenter(s) {
    if (s < 165.0) {
      return { x: 0.0, y: s, headingDeg: 0.0, isTurn: false };
    } else if (s < 255.0) {
      const turnProgress = (s - 165.0) / 90.0;
      const angle = turnProgress * (Math.PI / 4.2);
      const radius = 95.0;
      const x = -radius * (1 - Math.cos(angle));
      const y = 165.0 + radius * Math.sin(angle);
      const headingDeg = -(angle * 180 / Math.PI);
      return { x, y, headingDeg, isTurn: true };
    } else {
      const straightS = s - 255.0;
      const angle = Math.PI / 4.2;
      const radius = 95.0;
      const x0 = -radius * (1 - Math.cos(angle));
      const y0 = 165.0 + radius * Math.sin(angle);
      const headingDeg = -42.0 * Math.max(0, 1 - straightS / 65.0);
      const rad = headingDeg * Math.PI / 180;
      return {
        x: x0 + straightS * Math.sin(rad),
        y: y0 + straightS * Math.cos(rad),
        headingDeg,
        isTurn: false
      };
    }
  }

  /**
   * Samples the perception frame at distance s
   */
  sampleAtDistance(s, animTime) {
    const loopS = ((s % this.totalLength) + this.totalLength) % this.totalLength;
    const road = this.getRoadCenter(loopS);

    // Scenario name & base speed
    let scenario = 'Urban Drive';
    let speedKmh = 22.1;
    if (loopS > 80 && loopS <= 160) {
      scenario = 'Pothole Detection';
      speedKmh = 20.4;
    } else if (loopS > 160 && loopS <= 250) {
      scenario = 'Left Turn';
      speedKmh = 16.9;
    } else if (loopS > 250) {
      scenario = 'Dynamic Turn';
      speedKmh = 18.5;
    }

    // World to Road-Relative Projection for Dynamic Vehicles
    const toRoadRelativeCoords = (wx, wy, roadX, roadY, roadHeadingRad) => {
      const dx = wx - roadX;
      const dy = wy - roadY;
      const cosH = Math.cos(roadHeadingRad);
      const sinH = Math.sin(roadHeadingRad);
      const relX = dx * cosH - dy * sinH;
      const relY = dx * sinH + dy * cosH;
      return [relX, relY];
    };

    // 1. Calculate Dynamic Vehicle positions
    const activeVehicles = [];
    this.dynamicVehicles.forEach(veh => {
      if (loopS >= veh.activeRange[0] && loopS <= veh.activeRange[1]) {
        const progress = loopS - veh.activeRange[0];
        const vwx = veh.startPos[0];
        const speedFactor = veh.track_id === '04' ? 0.55 : 0.85;
        const vwy = veh.startPos[1] + progress * speedFactor;
        activeVehicles.push({
          track_id: veh.track_id,
          name: veh.name,
          class: veh.class,
          ui_class: 'Dynamic Vehicle',
          worldPos: [vwx, vwy],
          speedMps: veh.speedMps,
          confidence: veh.confidence,
          bbox: veh.bbox
        });
      }
    });

    // 2. Realistic Lane Discipline & Obstacle Avoidance
    let targetLateralBias = 0.0;
    const PROXIMITY_THRESHOLD_M = 22.0;

    // A. Avoid approaching/overtaken vehicles (give way laterally to the left if passing car on right)
    activeVehicles.forEach(veh => {
      const dy = veh.worldPos[1] - road.y;
      const dx = veh.worldPos[0] - road.x;

      if (dy > -6.0 && dy < PROXIMITY_THRESHOLD_M) {
        const shiftSign = dx >= 0 ? -1.3 : 1.3;
        const proximityWeight = dy > 0 ? (PROXIMITY_THRESHOLD_M - dy) / PROXIMITY_THRESHOLD_M : 1.0;
        targetLateralBias = shiftSign * 1.3 * proximityWeight;
      }
    });

    // B. Smoothly steer car around Pothole #21 in the right lane (x=+2.0m, stationS=120m)
    if (loopS >= 92.0 && loopS <= 142.0) {
      const potholeDist = loopS - 92.0;
      const potholeAvoid = Math.sin((potholeDist / 50.0) * Math.PI);
      targetLateralBias = -1.7 * potholeAvoid;
    }

    // Exponential smoothing filter for natural steering
    this.currentLateralBias += (targetLateralBias - this.currentLateralBias) * 0.08;

    const roadRad = (road.headingDeg * Math.PI) / 180;
    const egoWorldX = road.x + Math.cos(roadRad) * this.currentLateralBias;
    const egoWorldY = road.y - Math.sin(roadRad) * this.currentLateralBias;
    const steeringYawDeg = (targetLateralBias - this.currentLateralBias) * 4.5 + (road.isTurn ? -3.5 : 0.0);
    const egoTotalHeadingDeg = road.headingDeg + steeringYawDeg;

    // Project All Objects into Perception View (Strictly locked to sidewalk / lane positions)
    const visibleObjects = [];

    // Static Objects & Static Humans (FIX 4: 0.0 m/s, Stationary on sides of road)
    this.staticObjects.forEach(obj => {
      // Relative forward distance along the track
      let deltaS = obj.stationS - loopS;
      if (deltaS < -this.totalLength / 2) deltaS += this.totalLength;
      if (deltaS > this.totalLength / 2) deltaS -= this.totalLength;

      const vx = obj.lateralOffset; // Fixed lateral sidewalk position (e.g. -7.0m for left poles, +7.2m for right poles)
      const vy = deltaS;
      const dist = Math.hypot(vx - this.currentLateralBias, vy);

      // Keep objects in view from 58m ahead to 25m behind
      if (vy > -25 && vy < 58 && Math.abs(vx) < 32) {
        visibleObjects.push({
          track_id: obj.track_id,
          name: obj.name,
          class: obj.class,
          ui_class: obj.ui_class,
          position: [Number(vx.toFixed(2)), Number(vy.toFixed(2))],
          velocity_mps: 0.0, // Forced 0.0 m/s
          distance_m: Number(dist.toFixed(1)),
          confidence: Math.round(obj.confidence * 100),
          is_dynamic: false,
          status: 'Stationary',
          radius: obj.radius || 1.0,
          bbox: obj.class === 'dynamic_human' ? { l: 0.6, w: 0.6, h: 1.75 } : { l: 0.6, w: 0.6, h: 2.0 }
        });
      }
    });

    // Dynamic Vehicles (Moving)
    activeVehicles.forEach(veh => {
      const [vx, vy] = toRoadRelativeCoords(veh.worldPos[0], veh.worldPos[1], road.x, road.y, roadRad);
      const dist = Math.hypot(vx - this.currentLateralBias, vy);

      if (vy > -25 && vy < 58 && Math.abs(vx) < 28) {
        visibleObjects.push({
          track_id: veh.track_id,
          name: veh.name,
          class: veh.class,
          ui_class: veh.ui_class,
          position: [Number(vx.toFixed(2)), Number(vy.toFixed(2))],
          velocity_mps: veh.speedMps,
          distance_m: Number(dist.toFixed(1)),
          confidence: Math.round(veh.confidence * 100),
          is_dynamic: true,
          status: 'Moving',
          bbox: veh.bbox
        });
      }
    });

    // Elevation telemetry
    let selHeight = 0.12;
    let terrHeight = 0.03;
    if (visibleObjects.some(o => o.class === 'pothole' && o.distance_m < 16)) {
      selHeight = -0.22;
      terrHeight = -0.18;
    } else if (scenario.includes('Turn')) {
      selHeight = 0.05;
    }

    const timeSec = s / (speedKmh / 3.6);
    const m = Math.floor(timeSec / 60);
    const sec = (timeSec % 60).toFixed(1);

    return {
      distanceTraveled: loopS,
      lateralOffset: this.currentLateralBias,
      steeringYawDeg,
      scene: {
        scenario,
        elapsed: `${String(m).padStart(2, '0')}:${sec.padStart(4, '0')}`,
        speed_kmh: speedKmh,
        heading_deg: Number(egoTotalHeadingDeg.toFixed(1)),
        heading_cardinal: egoTotalHeadingDeg < -15 ? 'W' : (egoTotalHeadingDeg > 15 ? 'E' : 'N'),
        position: [Number(egoWorldX.toFixed(1)), Number(egoWorldY.toFixed(1))],
        system_time: `17:55:${String(Math.floor(12 + (timeSec % 48))).padStart(2, '0')}`,
        mode: 'SIMULATION (CARLA)',
        status: 'ONLINE'
      },
      objects: visibleObjects,
      elevation: {
        selected_cell_height_m: selHeight,
        local_terrain_height_m: terrHeight
      },
      metrics: {
        fps: Math.round(30 + Math.sin(timeSec) * 2),
        latency_ms: Math.round(32 + Math.cos(timeSec) * 3),
        miou: Number((87.5 + Math.sin(timeSec * 0.4) * 1.5).toFixed(1)),
        grid_cells: Math.floor(13400 + Math.sin(timeSec * 0.8) * 600),
        compute_savings_pct: Number((62.8 + Math.cos(timeSec * 0.5) * 1.2).toFixed(1)),
        memory_mb: 432
      }
    };
  }
}

export const WORLD_MODEL = new WorldModel();
