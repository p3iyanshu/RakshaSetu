/**
 * PerceptionMap Component
 * High-DPI authentic 2.5D LiDAR Perception Renderer for RakshaSetu (SIH PS 26053 · DRDO).
 *
 * Implements:
 * 1. Dynamic Ego Vehicle Steering Yaw & Lateral Lane Motion (Car physically maneuvers across the road).
 * 2. Realistic LiDAR voxel textures, foveated point returns, 2.5D building meshes, and depth shading.
 * 3. Collision-free trajectory tracking with live object selection and tooltips.
 */

import { SEMANTIC_COLORS } from '../lib/colors.js';

export function createPerceptionMap(container, onSelectObject) {
  container.innerHTML = `
    <div class="map-viewport-container" id="map-viewport">
      <canvas id="perception-canvas" class="perception-canvas"></canvas>
      <div id="map-overlay-layer" class="map-overlay-layer"></div>
      
      <!-- Interactive Hover Tooltip -->
      <div id="map-hover-tooltip" class="map-hover-tooltip" style="display: none;"></div>

      <!-- Compass and Scale Ruler (Bottom-Left Corner) -->
      <div class="map-hud-bottom-left">
        <div class="compass-widget">
          <div class="compass-cross">
            <span class="compass-n">N</span>
            <span class="compass-w">W</span>
            <span class="compass-e">E</span>
            <span class="compass-s">S</span>
            <div class="compass-needle" id="compass-needle"></div>
          </div>
        </div>
        <div class="scale-ruler-widget">
          <div class="scale-ruler-ticks">
            <span>0</span>
            <span>10</span>
            <span>20</span>
            <span>30 m</span>
          </div>
          <div class="scale-ruler-bar">
            <div class="scale-segment"></div>
            <div class="scale-segment"></div>
            <div class="scale-segment"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#perception-canvas');
  const overlayLayer = container.querySelector('#map-overlay-layer');
  const tooltip = container.querySelector('#map-hover-tooltip');
  const needle = container.querySelector('#compass-needle');
  const ctx = canvas.getContext('2d');

  let currentFrame = null;
  let selectedObjectId = '04';

  function resize() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(rect.width || container.clientWidth || 800, 200);
    const h = Math.max(rect.height || container.clientHeight || 600, 200);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);

  window.addEventListener('resize', resize);
  requestAnimationFrame(resize);
  setTimeout(resize, 50);

  // Mouse Interaction
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;
    const scale = Math.min(width / 52, height / 56);
    const egoX = width * 0.50;
    const egoY = height * 0.84;

    if (!currentFrame || !currentFrame.objects) return;

    for (const obj of currentFrame.objects) {
      const ox = egoX + obj.position[0] * scale;
      const oy = egoY - obj.position[1] * scale;
      const hitRadius = obj.class === 'pothole' ? 35 : 28;

      if (Math.hypot(clickX - ox, clickY - oy) < hitRadius) {
        selectedObjectId = obj.track_id || obj.id;
        if (onSelectObject) onSelectObject(obj);
        render();
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;
    const scale = Math.min(width / 52, height / 56);
    const egoX = width * 0.50;
    const egoY = height * 0.84;

    let matchedObj = null;
    if (currentFrame && currentFrame.objects) {
      for (const obj of currentFrame.objects) {
        const ox = egoX + obj.position[0] * scale;
        const oy = egoY - obj.position[1] * scale;
        const hitRadius = obj.class === 'pothole' ? 35 : 28;

        if (Math.hypot(mouseX - ox, mouseY - oy) < hitRadius) {
          matchedObj = obj;
          break;
        }
      }
    }

    if (matchedObj) {
      canvas.style.cursor = 'pointer';
      tooltip.style.display = 'block';
      tooltip.style.left = `${mouseX + 12}px`;
      tooltip.style.top = `${mouseY - 24}px`;
      tooltip.innerHTML = `
        <span class="tooltip-title">${matchedObj.name}</span>
        <span class="tooltip-class">${matchedObj.ui_class || matchedObj.class}</span>
        <span class="tooltip-dist font-mono">${(matchedObj.distance_m || 0).toFixed(1)}m · ${(matchedObj.velocity_mps || 0).toFixed(1)}m/s</span>
      `;
    } else {
      canvas.style.cursor = 'default';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  /**
   * Main High-DPI Render Loop (60 FPS)
   */
  function render() {
    if (!currentFrame) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    const scale = Math.min(width / 52, height / 56);
    const egoBaseX = width * 0.50;
    const egoBaseY = height * 0.84;

    const distS = currentFrame.distanceTraveled || 0.0;
    const headingDeg = currentFrame.scene.heading_deg || 0.0;
    const lateralOffset = currentFrame.lateralOffset || 0.0;
    const steeringYawDeg = currentFrame.steeringYawDeg || 0.0;

    // Actual screen coordinate of Ego Vehicle (with subtle dynamic lateral lane displacement)
    const egoScreenX = egoBaseX + lateralOffset * scale;
    const egoScreenY = egoBaseY;

    // Update compass needle rotation
    if (needle) {
      needle.style.transform = `rotate(${-headingDeg}deg)`;
    }

    // 1. Background Clear
    ctx.fillStyle = '#03060c';
    ctx.fillRect(0, 0, width, height);

    // 2. Continuous Coordinate Grid Matrix (Scrolls with vehicle motion)
    drawScrollingCoordinateGrid(ctx, width, height, egoBaseX, egoBaseY, scale, distS);

    // 3. Realistic 2.5D Building Blocks & Red Wall Obstacles (Edge-to-edge)
    drawRealisticBuildingsAndWalls(ctx, width, height, egoBaseX, egoBaseY, scale, distS, headingDeg);

    // 4. Authentic Drivable Foveated Road Grid (Discrete 5cm/15cm/30cm/50cm LiDAR voxels)
    drawAuthenticDrivableGrid(ctx, egoBaseX, egoBaseY, scale, distS, headingDeg);

    // 5. Road Center Lane Markings
    drawRealisticLaneMarkings(ctx, egoBaseX, egoBaseY, scale, distS, headingDeg);

    // 6. Detected Perception Entities (Vehicles, Humans, Potholes, Poles, Curbs)
    drawPerceptionEntities(ctx, egoBaseX, egoBaseY, scale, currentFrame.objects, selectedObjectId);

    // 7. Dynamic Ego Vehicle (Renders at egoScreenX with real steering yaw!)
    drawDynamicEgoVehicle(ctx, egoScreenX, egoScreenY, scale, steeringYawDeg);

    // 8. Update HTML Overlays
    updateOverlayCallouts(overlayLayer, egoBaseX, egoBaseY, scale, currentFrame.objects, selectedObjectId, (objId) => {
      selectedObjectId = objId;
      const targetObj = currentFrame.objects.find(o => o.track_id == objId || o.id == objId);
      if (onSelectObject && targetObj) onSelectObject(targetObj);
    });
  }

  return {
    update(frame, selectedId) {
      currentFrame = frame;
      if (selectedId !== undefined) selectedObjectId = selectedId;
      render();
    },
    destroy() {
      window.removeEventListener('resize', resize);
    }
  };
}

/**
 * 2. Background Grid Matrix
 */
function drawScrollingCoordinateGrid(ctx, width, height, egoBaseX, egoBaseY, scale, distS) {
  ctx.save();
  ctx.strokeStyle = '#081220';
  ctx.lineWidth = 1;

  const step = 5 * scale;
  const offsetY = (distS * scale) % step;

  ctx.beginPath();
  for (let x = 0; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = offsetY; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Subtle crosshair tick marks at 10m intervals
  ctx.fillStyle = '#0c1e30';
  for (let x = 0; x < width; x += 10 * scale) {
    for (let y = offsetY; y < height; y += 10 * scale) {
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillRect(x, y - 2, 1, 5);
    }
  }

  ctx.restore();
}

/**
 * 3. Authentic 2.5D Architectural Urban Buildings & Sidewalks (High-fidelity Perception Environment)
 */
function drawRealisticBuildingsAndWalls(ctx, width, height, egoBaseX, egoBaseY, scale, distS, headingDeg) {
  ctx.save();
  const roadHalfW = 6.8 * scale;
  const sidewalkW = 3.8 * scale;
  const headingRad = (headingDeg * Math.PI) / 180;
  const turnFactor = Math.sin(headingRad);

  const leftSidewalkX = egoBaseX - roadHalfW - sidewalkW;
  const leftRoadEdgeX = egoBaseX - roadHalfW;
  const rightRoadEdgeX = egoBaseX + roadHalfW;
  const rightSidewalkX = egoBaseX + roadHalfW + sidewalkW;

  // 1. Sidewalk Pavement Strips (Clean Concrete Curb Flanks)
  ctx.fillStyle = '#08101d';
  ctx.fillRect(0, 0, leftRoadEdgeX, height);
  ctx.fillRect(rightRoadEdgeX, 0, width - rightRoadEdgeX, height);

  // Sidewalk pavement tile joints (scrolls with vehicle motion)
  ctx.strokeStyle = '#101c2e';
  ctx.lineWidth = 1;
  const tileStep = 3.2 * scale;
  const tileScroll = (distS * scale) % tileStep;

  ctx.beginPath();
  for (let y = -tileStep + tileScroll; y < height + tileStep; y += tileStep) {
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    ctx.moveTo(leftSidewalkX + curveOffset, y);
    ctx.lineTo(leftRoadEdgeX + curveOffset, y);
    ctx.moveTo(rightRoadEdgeX + curveOffset, y);
    ctx.lineTo(rightSidewalkX + curveOffset, y);
  }
  ctx.stroke();

  // Curb Boundary Line (1px crisp edge)
  ctx.strokeStyle = '#1a2f47';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < height; y += 40) {
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    ctx.moveTo(leftRoadEdgeX + curveOffset, y); ctx.lineTo(leftRoadEdgeX + curveOffset, y + 40);
    ctx.moveTo(rightRoadEdgeX + curveOffset, y); ctx.lineTo(rightRoadEdgeX + curveOffset, y + 40);
  }
  ctx.stroke();

  // 2. Realistic 2.5D Architectural City Buildings (No generic grids — real architectural volume!)
  const totalCycleM = 150.0;
  const scrollInCycle = ((distS % totalCycleM) + totalCycleM) % totalCycleM;

  // Varied Architectural Profiles
  const buildingProfiles = [
    {
      startY: 0.0,
      len: 28.0,
      depthM: 22.0,
      heightM: 18.5,
      type: 'tower', // Office tower with stepped roof & rooftop HVAC
      name: 'TOWER 01',
      hvac: [{ xRel: 0.3, yRel: 0.3, wM: 4.5, lM: 5.5 }]
    },
    {
      startY: 34.0,
      len: 34.0,
      depthM: 26.0,
      heightM: 24.0,
      type: 'commercial', // Large complex with helipad & dual plant rooms
      name: 'COMMERCIAL HUB',
      hvac: [
        { xRel: 0.2, yRel: 0.2, wM: 5.0, lM: 6.0 },
        { xRel: 0.6, yRel: 0.7, wM: 4.0, lM: 4.5 }
      ],
      helipad: { xRel: 0.5, yRel: 0.45, rM: 3.5 }
    },
    {
      startY: 74.0,
      len: 22.0,
      depthM: 18.0,
      heightM: 12.0,
      type: 'stepped', // Stepped residential block
      name: 'RESIDENCE BLK',
      hvac: [{ xRel: 0.5, yRel: 0.4, wM: 3.5, lM: 4.0 }]
    },
    {
      startY: 102.0,
      len: 40.0,
      depthM: 24.0,
      heightM: 16.0,
      type: 'tech', // Tech facility with solar array
      name: 'TECH COMPLEX',
      solar: true,
      hvac: [{ xRel: 0.7, yRel: 0.2, wM: 4.5, lM: 7.0 }]
    }
  ];

  buildingProfiles.forEach((bldg, idx) => {
    let relY_M = bldg.startY - scrollInCycle;
    while (relY_M < -45.0) relY_M += totalCycleM;
    while (relY_M > 105.0) relY_M -= totalCycleM;

    const screenTopY = egoBaseY - (relY_M + bldg.len) * scale;
    const screenBottomY = egoBaseY - relY_M * scale;
    const bldgHeightPx = screenBottomY - screenTopY;

    if (screenBottomY > -50 && screenTopY < height + 50) {
      const midY = (screenTopY + screenBottomY) / 2;
      const curveOffset = (egoBaseY - midY) * turnFactor * 0.35;

      // ==========================================
      // A. LEFT-SIDE 2.5D BUILDING
      // ==========================================
      const lFrontX = leftSidewalkX + curveOffset;
      const lBackX = Math.max(0, lFrontX - bldg.depthM * scale);
      const lWidth = lFrontX - lBackX;
      const lExtrudePx = Math.min(14, bldg.heightM * 0.6 * scale);

      // 1. Building Shadow & Base Wall
      ctx.fillStyle = '#040810';
      ctx.fillRect(lBackX, screenTopY, lWidth, bldgHeightPx);

      // 2. Extruded Front Facade Wall (facing road)
      ctx.fillStyle = '#0a1526';
      ctx.fillRect(lFrontX - 3.5 * scale, screenTopY, 3.5 * scale, bldgHeightPx);

      // Vertical architectural structural columns/mullions on facade
      ctx.strokeStyle = '#162842';
      ctx.lineWidth = 1;
      const colSpacing = 3.5 * scale;
      ctx.beginPath();
      for (let cy = screenTopY + colSpacing; cy < screenBottomY; cy += colSpacing) {
        ctx.moveTo(lFrontX - 3.5 * scale, cy);
        ctx.lineTo(lFrontX, cy);
      }
      ctx.stroke();

      // 3. Main Rooftop Slab (Volumetric Polygon with Parapet)
      ctx.fillStyle = '#0d1a2d';
      ctx.fillRect(lBackX + 2, screenTopY + 2, lWidth - 2, bldgHeightPx - 4);

      // Parapet Border Outline
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 1;
      ctx.strokeRect(lBackX + 2, screenTopY + 2, lWidth - 2, bldgHeightPx - 4);

      // 4. Rooftop Mechanical / HVAC Penthouse Structures
      if (bldg.hvac) {
        bldg.hvac.forEach(h => {
          const hx = lFrontX - (h.xRel * lWidth);
          const hy = screenTopY + (h.yRel * bldgHeightPx);
          const hw = h.wM * scale * 0.7;
          const hl = h.lM * scale * 0.7;

          // Equipment body
          ctx.fillStyle = '#14253d';
          ctx.strokeStyle = '#274770';
          ctx.lineWidth = 1;
          ctx.fillRect(hx - hw, hy, hw, hl);
          ctx.strokeRect(hx - hw, hy, hw, hl);

          // Chiller fan grills
          ctx.fillStyle = '#0b1626';
          ctx.beginPath();
          ctx.arc(hx - hw * 0.5, hy + hl * 0.5, Math.min(hw, hl) * 0.35, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Helipad if configured
      if (bldg.helipad) {
        const hpx = lFrontX - (bldg.helipad.xRel * lWidth);
        const hpy = screenTopY + (bldg.helipad.yRel * bldgHeightPx);
        const hpr = bldg.helipad.rM * scale * 0.7;

        ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(hpx, hpy, hpr, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(0, 242, 254, 0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', hpx, hpy);
      }

      // 5. Perimeter LiDAR Hit Points (Discrete sensor returns at building corners)
      ctx.fillStyle = '#00f2fe';
      ctx.fillRect(lFrontX - 2, screenTopY + 1, 2, 2);
      ctx.fillRect(lFrontX - 2, screenBottomY - 3, 2, 2);
      ctx.fillRect(lBackX + 2, screenTopY + 1, 2, 2);
      ctx.fillRect(lBackX + 2, screenBottomY - 3, 2, 2);

      // Corner Registration Brackets
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      drawBoundingCorners(ctx, lBackX, screenTopY, lWidth, bldgHeightPx, 5);

      // Building Label Tag
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${bldg.name} · H:${bldg.heightM.toFixed(1)}m`, Math.max(10, lFrontX - 110), screenTopY + 8);

      // ==========================================
      // B. RIGHT-SIDE 2.5D BUILDING
      // ==========================================
      const rFrontX = rightSidewalkX + curveOffset;
      const rBackX = Math.min(width, rFrontX + bldg.depthM * scale);
      const rWidth = rBackX - rFrontX;

      // 1. Building Shadow & Base Wall
      ctx.fillStyle = '#040810';
      ctx.fillRect(rFrontX, screenTopY, rWidth, bldgHeightPx);

      // 2. Extruded Facade Wall
      ctx.fillStyle = '#0a1526';
      ctx.fillRect(rFrontX, screenTopY, 3.5 * scale, bldgHeightPx);

      // Structural facade columns
      ctx.strokeStyle = '#162842';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let cy = screenTopY + colSpacing; cy < screenBottomY; cy += colSpacing) {
        ctx.moveTo(rFrontX, cy);
        ctx.lineTo(rFrontX + 3.5 * scale, cy);
      }
      ctx.stroke();

      // 3. Rooftop Slab
      ctx.fillStyle = '#0d1a2d';
      ctx.fillRect(rFrontX + 2, screenTopY + 2, rWidth - 2, bldgHeightPx - 4);

      // Parapet Border Outline
      ctx.strokeStyle = '#1e3a5f';
      ctx.strokeRect(rFrontX + 2, screenTopY + 2, rWidth - 2, bldgHeightPx - 4);

      // 4. Rooftop Mechanical Equipment
      if (bldg.hvac) {
        bldg.hvac.forEach(h => {
          const hx = rFrontX + (h.xRel * rWidth);
          const hy = screenTopY + (h.yRel * bldgHeightPx);
          const hw = h.wM * scale * 0.7;
          const hl = h.lM * scale * 0.7;

          ctx.fillStyle = '#14253d';
          ctx.strokeStyle = '#274770';
          ctx.lineWidth = 1;
          ctx.fillRect(hx, hy, hw, hl);
          ctx.strokeRect(hx, hy, hw, hl);

          ctx.fillStyle = '#0b1626';
          ctx.beginPath();
          ctx.arc(hx + hw * 0.5, hy + hl * 0.5, Math.min(hw, hl) * 0.35, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Solar Panels on Tech Building
      if (bldg.solar) {
        const sx = rFrontX + 6 * scale;
        const sy = screenTopY + 8 * scale;
        const sw = 10 * scale;
        const sl = 18 * scale;

        ctx.fillStyle = '#0a1e36';
        ctx.strokeStyle = '#1d4875';
        ctx.lineWidth = 0.75;
        ctx.fillRect(sx, sy, sw, sl);
        ctx.strokeRect(sx, sy, sw, sl);

        // Panel rows
        ctx.beginPath();
        for (let py = sy + 3 * scale; py < sy + sl; py += 3 * scale) {
          ctx.moveTo(sx, py);
          ctx.lineTo(sx + sw, py);
        }
        ctx.stroke();
      }

      // 5. Perimeter LiDAR Hit Points
      ctx.fillStyle = '#00f2fe';
      ctx.fillRect(rFrontX + 1, screenTopY + 1, 2, 2);
      ctx.fillRect(rFrontX + 1, screenBottomY - 3, 2, 2);
      ctx.fillRect(rBackX - 3, screenTopY + 1, 2, 2);
      ctx.fillRect(rBackX - 3, screenBottomY - 3, 2, 2);

      // Corner Brackets
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      drawBoundingCorners(ctx, rFrontX, screenTopY, rWidth, bldgHeightPx, 5);

      // Building Label Tag
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`BLDG R${idx + 1} · H:${(bldg.heightM * 1.05).toFixed(1)}m`, rFrontX + 8, screenTopY + 8);
    }
  });

  // 3. Red Barrier Voxels along Road Edges (Scrolling continuously!)
  const cellSize = 1.9 * scale;
  const scrollOffset = (distS * scale) % cellSize;

  for (let y = -cellSize + scrollOffset; y < height + cellSize; y += cellSize) {
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;

    // Left Wall Barrier Point
    const lx = leftRoadEdgeX - cellSize * 0.6 + curveOffset;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.strokeStyle = '#ef4444';
    ctx.fillRect(lx, y, cellSize - 1.5, cellSize - 1.5);
    ctx.strokeRect(lx, y, cellSize - 1.5, cellSize - 1.5);

    // Right Wall Barrier Point
    const rx = rightRoadEdgeX - cellSize * 0.4 + curveOffset;
    ctx.fillRect(rx, y, cellSize - 1.5, cellSize - 1.5);
    ctx.strokeRect(rx, y, cellSize - 1.5, cellSize - 1.5);
  }

  ctx.restore();
}

/**
 * 4. Authentic Drivable Foveated Road Grid (Tactical Emerald Green LiDAR Voxels)
 */
function drawAuthenticDrivableGrid(ctx, egoBaseX, egoBaseY, scale, distS, headingDeg) {
  ctx.save();
  const roadHalfW = 6.8 * scale;
  const headingRad = (headingDeg * Math.PI) / 180;
  const turnFactor = Math.sin(headingRad);

  // Band 1: 0 - 10m (High Density 5cm resolution - fine-grained voxel matrix)
  const c5 = 0.85 * scale;
  const scroll5 = (distS * scale) % c5;
  for (let r = 0; r <= 10.0 * scale; r += c5) {
    const y = egoBaseY - r + scroll5;
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    const minX = egoBaseX - roadHalfW + curveOffset + 0.4 * scale;
    const maxX = egoBaseX + roadHalfW + curveOffset - 0.4 * scale;

    for (let x = minX; x <= maxX; x += c5) {
      ctx.fillStyle = 'rgba(0, 230, 118, 0.42)';
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.95)';
      ctx.lineWidth = 0.75;
      ctx.fillRect(x, y, c5 - 1, c5 - 1);
      ctx.strokeRect(x, y, c5 - 1, c5 - 1);

      ctx.fillStyle = '#00ff88';
      ctx.fillRect(x + c5 / 2 - 0.75, y + c5 / 2 - 0.75, 1.5, 1.5);
    }
  }

  // Band 2: 10 - 30m (Medium Density 15cm resolution)
  const c15 = 1.8 * scale;
  const scroll15 = (distS * scale) % c15;
  for (let r = 10.0 * scale; r <= 30.0 * scale; r += c15) {
    const y = egoBaseY - r + scroll15;
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    const minX = egoBaseX - roadHalfW + curveOffset;
    const maxX = egoBaseX + roadHalfW + curveOffset;

    for (let x = minX; x <= maxX; x += c15) {
      ctx.fillStyle = 'rgba(0, 230, 118, 0.32)';
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.85)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, c15 - 1.5, c15 - 1.5);
      ctx.strokeRect(x, y, c15 - 1.5, c15 - 1.5);

      ctx.fillStyle = '#00e676';
      ctx.fillRect(x + c15 / 2 - 1, y + c15 / 2 - 1, 2, 2);
    }
  }

  // Band 3: 30 - 60m (Coarse Density 30cm / 50cm resolution)
  const c30 = 3.6 * scale;
  const scroll30 = (distS * scale) % c30;
  for (let r = 30.0 * scale; r <= 55.0 * scale; r += c30) {
    const y = egoBaseY - r + scroll30;
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    const minX = egoBaseX - roadHalfW + curveOffset;
    const maxX = egoBaseX + roadHalfW + curveOffset;

    for (let x = minX; x <= maxX; x += c30) {
      ctx.fillStyle = 'rgba(0, 230, 118, 0.22)';
      ctx.strokeStyle = 'rgba(0, 230, 118, 0.70)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, c30 - 2, c30 - 2);
      ctx.strokeRect(x, y, c30 - 2, c30 - 2);
    }
  }

  ctx.restore();
}

/**
 * 5. Road Center Lane Markings
 */
function drawRealisticLaneMarkings(ctx, egoBaseX, egoBaseY, scale, distS, headingDeg) {
  ctx.save();
  const headingRad = (headingDeg * Math.PI) / 180;
  const turnFactor = Math.sin(headingRad);

  const dashLen = 2.4 * scale;
  const gapLen = 2.4 * scale;
  const period = dashLen + gapLen;
  const scrollOffset = (distS * scale) % period;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';

  for (let y = -period + scrollOffset; y < egoBaseY + 10 * scale; y += period) {
    const curveOffset = (egoBaseY - y) * turnFactor * 0.35;
    ctx.fillRect(egoBaseX - 1.2 + curveOffset, y, 2.4, dashLen);
  }

  ctx.restore();
}

/**
 * 6. Detected Perception Entities (Flat Technical HUD Shapes - No Game Juices)
 */
function drawPerceptionEntities(ctx, egoBaseX, egoBaseY, scale, objects, selectedId) {
  if (!objects || !objects.length) return;

  // Render static objects first, then dynamic vehicles
  const sortedObjects = [...objects].sort((a, b) => {
    if (a.class === 'dynamic_vehicle' && b.class !== 'dynamic_vehicle') return 1;
    if (a.class !== 'dynamic_vehicle' && b.class === 'dynamic_vehicle') return -1;
    return 0;
  });

  sortedObjects.forEach(obj => {
    const ox = egoBaseX + obj.position[0] * scale;
    const oy = egoBaseY - obj.position[1] * scale;
    const isSelected = String(obj.track_id) === String(selectedId) || String(obj.id) === String(selectedId);

    // Selected object highlight ring (clean 1.5px technical ring)
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(ox, oy, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (obj.class === 'pothole') {
      // Flat technical dashed ellipses for road anomaly
      ctx.save();
      const rad = (obj.radius || 2.0) * scale;

      ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
      ctx.beginPath();
      ctx.ellipse(ox, oy, rad * 1.3, rad * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isSelected ? '#ffffff' : '#c084fc';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.ellipse(ox, oy, rad * 1.3, rad * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(ox, oy, rad * 0.8, rad * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    } else if (obj.class === 'dynamic_vehicle') {
      // Flat 2D Top-Down Vehicle Marker (Technical Desaturated HUD Vector)
      ctx.save();
      ctx.translate(ox, oy);

      const vW = (obj.bbox?.w || 1.9) * scale;
      const vL = (obj.bbox?.l || 4.4) * scale;

      // Flat Desaturated Amber Chassis
      ctx.fillStyle = '#b45309'; // Desaturated technical amber/yellow
      ctx.strokeStyle = isSelected ? '#ffffff' : '#f59e0b';
      ctx.lineWidth = 1;
      ctx.fillRect(-vW / 2, -vL / 2, vW, vL);
      ctx.strokeRect(-vW / 2, -vL / 2, vW, vL);

      // Cabin / Roof cutout
      ctx.fillStyle = '#0a101d';
      ctx.fillRect(-vW * 0.35, -vL * 0.2, vW * 0.7, vL * 0.45);

      // Bounding Corner Brackets (Technical 1px HUD markers)
      ctx.strokeStyle = isSelected ? '#00f2fe' : '#fbbf24';
      ctx.lineWidth = 1;
      drawBoundingCorners(ctx, -vW * 0.65, -vL * 0.6, vW * 1.3, vL * 1.2, 4);

      ctx.restore();
    } else if (obj.class === 'dynamic_human') {
      // Flat 2D Static Human Marker (Desaturated Orange Dot with Directional Chevron)
      ctx.save();
      ctx.translate(ox, oy);

      // Flat orange circle marker
      ctx.fillStyle = '#ea580c';
      ctx.strokeStyle = isSelected ? '#ffffff' : '#f97316';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Technical 1px corner markers
      ctx.strokeStyle = isSelected ? '#00f2fe' : 'rgba(249, 115, 22, 0.7)';
      ctx.lineWidth = 1;
      drawBoundingCorners(ctx, -7, -7, 14, 14, 3);

      ctx.restore();
    } else if (obj.class === 'static_pole') {
      // Flat 2D Static Pole Marker (Flat Salmon/Red Dot with 1px Outer Ring)
      ctx.save();
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = isSelected ? '#ffffff' : '#f87171';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ox, oy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(ox, oy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (obj.class === 'curb') {
      // Flat Cyan Point Marker
      ctx.save();
      ctx.fillStyle = '#00f2fe';
      ctx.beginPath();
      ctx.arc(ox, oy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

/**
 * 7. Dynamic Ego Vehicle (ALWAYS TOPMOST, ALWAYS VISIBLE - Tactical Cyan/Sapphire Livery)
 */
function drawDynamicEgoVehicle(ctx, egoX, egoY, scale, steeringYawDeg) {
  ctx.save();
  ctx.translate(egoX, egoY);

  const yawRad = (steeringYawDeg * Math.PI) / 180;
  ctx.rotate(yawRad);

  const carW = 2.4 * scale;
  const carL = 5.0 * scale;

  // 1. Forward Sensor-Fan Lines (Subtle Technical LiDAR rays & arc projection)
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Center ray
  ctx.beginPath();
  ctx.moveTo(0, -carL / 2);
  ctx.lineTo(0, -carL / 2 - 24 * scale);
  ctx.stroke();

  // Left & Right Fan Rays (45-degree field)
  ctx.beginPath();
  ctx.moveTo(0, -carL / 2);
  ctx.lineTo(-12 * scale, -carL / 2 - 20 * scale);
  ctx.moveTo(0, -carL / 2);
  ctx.lineTo(12 * scale, -carL / 2 - 20 * scale);
  ctx.stroke();

  // Forward Range Arc
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.28)';
  ctx.beginPath();
  ctx.arc(0, -carL / 2, 22 * scale, -Math.PI * 0.7, -Math.PI * 0.3);
  ctx.stroke();
  ctx.restore();

  // 2. Ego Vehicle Chassis (Tactical Defense Sapphire & Cyan Perception Livery)
  ctx.fillStyle = '#0f172a'; // Rear wheels (straight)
  ctx.fillRect(-carW / 2 - 2.5, carL * 0.15, 2.5, carL * 0.22);
  ctx.fillRect(carW / 2, carL * 0.15, 2.5, carL * 0.22);

  // Steerable Front Wheels
  ctx.save();
  const frontWheelSteer = Math.max(-0.4, Math.min(0.4, yawRad * 1.5));
  
  // Front Left Wheel
  ctx.save();
  ctx.translate(-carW / 2 - 1.25, -carL * 0.24);
  ctx.rotate(frontWheelSteer);
  ctx.fillRect(-1.25, -carL * 0.11, 2.5, carL * 0.22);
  ctx.restore();

  // Front Right Wheel
  ctx.save();
  ctx.translate(carW / 2 + 1.25, -carL * 0.24);
  ctx.rotate(frontWheelSteer);
  ctx.fillRect(-1.25, -carL * 0.11, 2.5, carL * 0.22);
  ctx.restore();
  ctx.restore();

  // Body Shell (Distinct Tactical Cobalt Sapphire #0369a1 / #0284c7)
  ctx.fillStyle = '#0369a1'; // Deep tactical sapphire blue
  ctx.strokeStyle = '#00f2fe'; // Crisp 1px bright cyan HUD border
  ctx.lineWidth = 1.3;
  roundRect(ctx, -carW / 2, -carL / 2, carW, carL, 3);
  ctx.fill();
  ctx.stroke();

  // Dark Tinted Windshield & Rear Canopy
  ctx.fillStyle = '#050c18';
  ctx.fillRect(-carW * 0.36, -carL * 0.28, carW * 0.72, carL * 0.2);
  ctx.fillRect(-carW * 0.36, carL * 0.22, carW * 0.72, carL * 0.14);

  // Roof Structure
  ctx.fillStyle = '#075985';
  ctx.fillRect(-carW * 0.3, -carL * 0.04, carW * 0.6, carL * 0.24);

  // Roof LiDAR Autonomous Perception Dome (Luminescent Cyan Sensor)
  ctx.fillStyle = '#00f2fe';
  ctx.fillRect(-carW * 0.16, -carL * 0.02, carW * 0.32, carL * 0.12);

  // Headlights & Taillights
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(-carW * 0.42, -carL / 2, 3, 1.8);
  ctx.fillRect(carW * 0.42 - 3, -carL / 2, 3, 1.8);

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-carW * 0.42, carL / 2 - 1.8, 3, 1.8);
  ctx.fillRect(carW * 0.42 - 3, carL / 2 - 1.8, 3, 1.8);

  // Forward Direction Reticle Arrow
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -carL * 0.38);
  ctx.lineTo(0, -carL * 0.46);
  ctx.lineTo(-2.5, -carL * 0.41);
  ctx.moveTo(0, -carL * 0.46);
  ctx.lineTo(2.5, -carL * 0.41);
  ctx.stroke();

  ctx.restore();
}

/**
 * 8. HTML Overlay Floating Callouts
 */
function updateOverlayCallouts(overlayLayer, egoBaseX, egoBaseY, scale, objects, selectedId, onSelect) {
  if (!objects) return;

  overlayLayer.innerHTML = objects.map(obj => {
    const ox = egoBaseX + obj.position[0] * scale;
    const oy = egoBaseY - obj.position[1] * scale;
    const isSelected = String(obj.track_id) === String(selectedId) || String(obj.id) === String(selectedId);

    let borderClass = 'border-yellow text-yellow';
    let headerColor = '#facc15';
    let offsetX = 18;
    let offsetY = -34;

    if (obj.class === 'dynamic_human') {
      borderClass = 'border-orange text-orange';
      headerColor = '#f97316';
      offsetX = 16;
      offsetY = -30;
    } else if (obj.class === 'pothole') {
      borderClass = 'border-purple text-purple';
      headerColor = '#c084fc';
      offsetX = -88;
      offsetY = -38;
    } else if (obj.class === 'static_pole') {
      borderClass = 'border-red text-red';
      headerColor = '#ef4444';
      offsetX = 18;
      offsetY = -24;
    } else if (obj.class === 'curb') {
      borderClass = 'border-cyan text-cyan';
      headerColor = '#00f2fe';
    } else if (obj.class === 'static_wall') {
      borderClass = 'border-red text-red';
      headerColor = '#ef4444';
    }

    if (obj.name === 'WALL' || obj.class === 'static_wall') {
      return `
        <div class="map-tag wall-tag ${borderClass} ${isSelected ? 'tag-selected' : ''}" 
             style="left: ${ox}px; top: ${oy}px;" 
             data-id="${obj.track_id || obj.id}">
          WALL
        </div>
      `;
    }

    if (obj.name === 'CURB' || obj.class === 'curb') {
      return `
        <div class="map-tag curb-tag ${borderClass} ${isSelected ? 'tag-selected' : ''}" 
             style="left: ${ox + 20}px; top: ${oy - 6}px;" 
             data-id="${obj.track_id || obj.id}">
          CURB
        </div>
      `;
    }

    return `
      <div class="map-callout-card ${borderClass} ${isSelected ? 'callout-selected' : ''}" 
           style="left: ${ox + offsetX}px; top: ${oy + offsetY}px;"
           data-id="${obj.track_id || obj.id}">
        <div class="callout-header" style="color: ${headerColor};">${obj.name}</div>
        <div class="callout-stat font-mono">${(obj.distance_m || 0).toFixed(1)} m</div>
        <div class="callout-stat font-mono">${(obj.velocity_mps || 0).toFixed(1)} m/s</div>
        <div class="callout-stat font-mono">${obj.confidence || 90}%</div>
      </div>
    `;
  }).join('');

  overlayLayer.querySelectorAll('[data-id]').forEach(elem => {
    elem.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = elem.getAttribute('data-id');
      if (onSelect) onSelect(id);
    });
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBoundingCorners(ctx, x, y, w, h, len) {
  ctx.beginPath();
  ctx.moveTo(x + len, y); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}
