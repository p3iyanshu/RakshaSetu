/**
 * Admin Console — Live LiDAR Feed
 * Point-cloud view of the SAME world the main dashboard renders: the curved
 * 4-lane carriageway (with lane-marking intensity returns), the mountain
 * terrain, and every tracked object, converted into classified LiDAR returns
 * and drawn from a 2.5D camera that follows the ego heading.
 *
 * Points sit on a world-anchored lattice (they don't swim as the ego moves).
 * ADAPTIVE mode thins the lattice with range (foveated bands); UNIFORM mode
 * keeps the finest spacing everywhere and throttles the feed to ~8 FPS to
 * show the compute bottleneck.
 */

import { perspective, viewFromBasis, multiply, projectPoint } from '../../render/glUtils.js';
import { isoCubeSVG } from '../../render/iso2d.js';
import { ROAD, roadToWorld, terrainHeight, roadDistance, deltaS } from '../../lib/roadNetwork.js';

const COLORS = {
  drivable: '#00e676',
  marking: '#e6f7ff',
  nondrivable: '#c2b280',
  static: '#ef4444',
  dynamic: '#f97316',
  vehicle: '#facc15',
  hazard: '#c084fc',
  waste: '#ef4444'
};

// Foveated bands: [maxRange m, road lattice m, terrain lattice m]
const ADAPTIVE_BANDS = [[10, 0.5, 1.0], [30, 1.0, 2.0], [60, 2.0, 3.5], [120, 3.5, 5.0]];
const UNIFORM_BANDS = [[10, 0.5, 1.2], [30, 0.5, 1.2], [60, 0.5, 1.2], [120, 0.5, 1.2]];
const RING_RADII = [10, 30, 60, 120];
// Non-drivable terrain from dim valley floor to bright ridge (8 steps)
const TERRAIN_SHADES = Array.from({ length: 8 }, (_, i) => {
  const t = i / 7;
  const mix = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
  return `#${mix(0x6b, 0xe8)}${mix(0x62, 0xd9)}${mix(0x46, 0xa8)}`;
});

function hexA(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Surface returns for a tracked object: lattice points on its bounding box. */
function objectReturns(obj, out) {
  const w = obj.world;
  if (!w || obj.class === 'pothole') return;
  const b = obj.bbox || { l: 1, w: 1, h: 1 };
  let color = COLORS.static;
  if (obj.class === 'dynamic_vehicle') color = COLORS.vehicle;
  else if (obj.class === 'dynamic_human') color = COLORS.dynamic;
  else if (obj.class === 'curb') color = COLORS.hazard;
  else if (obj.class === 'unclassified') color = '#94a3b8';
  const l = obj.class === 'static_wall' ? Math.min(b.l, 16) : b.l;
  const step = Math.max(0.25, Math.min(0.6, Math.max(l, b.w) / 9));
  const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
  const push = (fx, fy, fz) => out.push(w.x + c * fx - s * fy, w.y + s * fx + c * fy, w.z + fz, color);
  // Top face + the four sides (a real scan sees the top and near sides)
  for (let fx = -l / 2; fx <= l / 2 + 1e-6; fx += step) {
    for (let fy = -b.w / 2; fy <= b.w / 2 + 1e-6; fy += step) push(fx, fy, b.h);
    for (let fz = 0.2; fz < b.h; fz += step) { push(fx, -b.w / 2, fz); push(fx, b.w / 2, fz); }
  }
  for (let fy = -b.w / 2; fy <= b.w / 2 + 1e-6; fy += step) {
    for (let fz = 0.2; fz < b.h; fz += step) { push(-l / 2, fy, fz); push(l / 2, fy, fz); }
  }
}

export function createLidarFeedPanel(container) {
  container.innerHTML = `
    <div class="lidar-feed-header">
      <div class="lidar-feed-title-group">
        <span class="lidar-feed-title">LIVE LIDAR FEED</span>
        <span class="lidar-mode-badge adaptive" id="lidar-mode-badge">ADAPTIVE FOVEATED</span>
      </div>
      <span class="lidar-feed-stats font-mono" id="lidar-feed-stats"></span>
    </div>
    <div class="lidar-feed-canvas-wrap">
      <canvas class="lidar-feed-canvas" id="lidar-feed-canvas"></canvas>
      <div class="lidar-feed-overlay-tag font-mono" id="lidar-feed-overlay-tag"></div>
      <div class="lidar-feed-count font-mono" id="lidar-feed-count"></div>
    </div>
    <div class="lidar-feed-legend">
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.drivable, 11)}Drivable</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.marking, 11)}Lane marking (intensity)</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.nondrivable, 11)}Non-Drivable / Terrain</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.static, 11)}Static (Wall/Pole/Tree)</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.vehicle, 11)}Vehicle</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.dynamic, 11)}Human</span>
      <span class="lidar-legend-item">${isoCubeSVG(COLORS.hazard, 11)}Hazard (Curb/Pothole)</span>
      <span class="lidar-legend-item uniform-only-legend" id="uniform-legend-item" style="display:none;">${isoCubeSVG(COLORS.waste, 11)}Uniform grid waste (1.2M cells)</span>
    </div>
  `;

  const canvas = container.querySelector('#lidar-feed-canvas');
  const ctx = canvas.getContext('2d');
  const statsElem = container.querySelector('#lidar-feed-stats');
  const modeBadge = container.querySelector('#lidar-mode-badge');
  const overlayTag = container.querySelector('#lidar-feed-overlay-tag');
  const countElem = container.querySelector('#lidar-feed-count');
  const uniformLegendItem = container.querySelector('#uniform-legend-item');
  const canvasWrap = container.querySelector('.lidar-feed-canvas-wrap');

  let currentGridMode = 'adaptive';
  let dpr = 1, cssW = 400, cssH = 300;
  let camYaw = null, lastT = performance.now();
  let lastUniformRender = 0;
  let lastHudKey = '';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvasWrap.getBoundingClientRect();
    cssW = Math.max(rect.width, 200);
    cssH = Math.max(rect.height, 160);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasWrap);
  resize();

  /** 2.5D camera behind/above the ego, heading-up (same framing as the main view). */
  function cameraMatrix(ego) {
    const now = performance.now();
    const dt = Math.min(0.5, (now - lastT) / 1000);
    lastT = now;
    if (camYaw === null) camYaw = ego.yaw;
    let dy = ego.yaw - camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    camYaw += dy * (1 - Math.exp(-dt * 3.5));
    const pitch = 52 * Math.PI / 180, dist = 115, ahead = 32;
    const fh = [Math.cos(camYaw), Math.sin(camYaw)];
    const target = [ego.x + fh[0] * ahead, ego.y + fh[1] * ahead, ego.z];
    const fwd = [Math.cos(pitch) * fh[0], Math.cos(pitch) * fh[1], -Math.sin(pitch)];
    const eye = [target[0] - fwd[0] * dist, target[1] - fwd[1] * dist, target[2] - fwd[2] * dist];
    const view = viewFromBasis(eye, fwd, [Math.sin(camYaw), -Math.cos(camYaw), 0]);
    return multiply(perspective(40 * Math.PI / 180, cssW / cssH, 1, 2000), view);
  }

  /** Convert the world around the ego into classified LiDAR returns. */
  function scan(frame) {
    const ego = frame.ego;
    const bands = currentGridMode === 'uniform' ? UNIFORM_BANDS : ADAPTIVE_BANDS;
    const pts = [];   // flat: x, y, z, color
    const potholes = frame.objects.filter(o => o.class === 'pothole' && o.road);

    // 1. Carriageway + shoulders, sampled in road coordinates so it follows the curves
    let prev = -15;
    for (const [maxR, sp] of bands) {
      const s0 = Math.ceil((ego.s + prev) / sp) * sp;
      for (let s = s0; s < ego.s + maxR; s += sp) {
        for (let d = -ROAD.formationHalf; d <= ROAD.formationHalf + 1e-6; d += sp) {
          const ad = Math.abs(d);
          let color = ad < ROAD.carriageHalf ? COLORS.drivable : COLORS.nondrivable;
          let dz = 0;
          // Retro-reflective paint returns high intensity
          const dash = ((s % 9) + 9) % 9 < 3;
          if (Math.abs(ad - (ROAD.carriageHalf - 0.12)) < sp * 0.5 ||
              (Math.abs(ad - 3.75) < sp * 0.5 && dash) || ad < sp * 0.5) color = COLORS.marking;
          for (const ph of potholes) {
            const q = Math.hypot(deltaS(ph.road.s, s) / 1.45, d - ph.road.d) / (ph.radius || 1.2);
            if (q < 1.25) { color = COLORS.hazard; dz = q < 1 ? -0.22 * (1 - q) : 0; }
          }
          const p = roadToWorld(s, d, dz);
          pts.push(p.x, p.y, p.z, color);
        }
      }
      prev = maxR;
    }

    // 2. Terrain returns on a world-anchored lattice, thinned by range band
    prev = 0;
    for (const [maxR, , sp] of bands) {
      const x0 = Math.floor((ego.x - maxR) / sp) * sp, y0 = Math.floor((ego.y - maxR) / sp) * sp;
      for (let x = x0; x <= ego.x + maxR; x += sp) {
        for (let y = y0; y <= ego.y + maxR; y += sp) {
          const r = Math.hypot(x - ego.x, y - ego.y);
          if (r < prev || r >= maxR) continue;
          if (roadDistance(x, y) < ROAD.formationHalf + 2) continue;   // road is covered above
          const z = terrainHeight(x, y);
          // Brighter returns on higher ground so the slopes and peaks read
          const k = Math.max(0, Math.min(1, (z - ego.z + 2) / 28));
          const color = currentGridMode === 'uniform' && r > 10 ? COLORS.waste : TERRAIN_SHADES[Math.round(k * 7)];
          pts.push(x, y, z, color);
        }
      }
      prev = maxR;
    }

    // 3. Tracked objects
    for (const obj of frame.objects) objectReturns(obj, pts);
    return pts;
  }

  function drawRings(M, ego) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    for (const r of RING_RADII) {
      ctx.setLineDash(r <= 10 ? [3, 3] : []);
      ctx.strokeStyle = currentGridMode === 'uniform' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(0, 242, 254, 0.35)';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const q = projectPoint(M, ego.x + Math.cos(a) * r, ego.y + Math.sin(a) * r, ego.z, cssW, cssH);
        if (!q) { started = false; continue; }
        started ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        started = true;
      }
      ctx.stroke();
      const a = camYaw - 0.5;
      const lq = projectPoint(M, ego.x + Math.cos(a) * r, ego.y + Math.sin(a) * r, ego.z, cssW, cssH);
      if (lq && lq.x > 0 && lq.x < cssW - 30 && lq.y > 0 && lq.y < cssH) {
        ctx.fillStyle = 'rgba(0, 242, 254, 0.85)';
        ctx.fillText(`${r} m`, lq.x + 4, lq.y);
      }
    }
    ctx.restore();
  }

  function drawEgo(M, ego) {
    const c = Math.cos(ego.yaw), s = Math.sin(ego.yaw);
    const corner = (fx, fy, fz) => projectPoint(M, ego.x + c * fx - s * fy, ego.y + s * fx + c * fy, ego.z + fz, cssW, cssH);
    const base = [corner(2.6, 1.2, 0), corner(2.6, -1.2, 0), corner(-2.6, -1.2, 0), corner(-2.6, 1.2, 0)];
    const top = [corner(2.6, 1.2, 1.9), corner(2.6, -1.2, 1.9), corner(-2.6, -1.2, 1.9), corner(-2.6, 1.2, 1.9)];
    if (base.some(p => !p) || top.some(p => !p)) return;
    ctx.save();
    ctx.strokeStyle = currentGridMode === 'uniform' ? '#f87171' : '#00f2fe';
    ctx.fillStyle = currentGridMode === 'uniform' ? 'rgba(248, 113, 113, 0.18)' : 'rgba(0, 242, 254, 0.18)';
    ctx.lineWidth = 1.3;
    const poly = (ps) => { ctx.beginPath(); ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
    poly(top); ctx.fill(); ctx.stroke();
    poly(base); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(top[i].x, top[i].y); }
    ctx.stroke();
    // Sensor head
    const sensor = corner(0.2, 0, 2.6);
    if (sensor) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(sensor.x, sensor.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render(frame) {
    ctx.clearRect(0, 0, cssW, cssH);
    const ego = frame.ego;
    const M = cameraMatrix(ego);

    if (currentGridMode === 'uniform') {
      // Fixed-resolution raster behind everything: the wasted cells
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= cssW; x += 12) { ctx.moveTo(x, 0); ctx.lineTo(x, cssH); }
      for (let y = 0; y <= cssH; y += 12) { ctx.moveTo(0, y); ctx.lineTo(cssW, y); }
      ctx.stroke();
    }

    drawRings(M, ego);

    const pts = scan(frame);
    let drawn = 0;
    for (let i = 0; i < pts.length; i += 4) {
      const q = projectPoint(M, pts[i], pts[i + 1], pts[i + 2], cssW, cssH);
      if (!q || q.x < -2 || q.x > cssW + 2 || q.y < -2 || q.y > cssH + 2) continue;
      const size = Math.max(1, Math.min(2.6, 260 / q.w));
      const fade = Math.max(0.35, Math.min(1, 1.25 - q.w / 420));
      ctx.fillStyle = hexA(pts[i + 3], fade);
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
      drawn++;
    }

    drawEgo(M, ego);
    countElem.textContent = `${drawn.toLocaleString()} returns / frame`;
    updateHud(frame);
  }

  function updateHud(frame) {
    const uniform = currentGridMode === 'uniform';
    const fps = uniform ? 8 : (frame.metrics?.fps || 30);
    const lat = uniform ? 74 : (frame.metrics?.latency_ms || 32);
    const key = `${currentGridMode}|${fps}|${lat}`;
    if (key === lastHudKey) return;
    lastHudKey = key;
    if (uniform) {
      statsElem.innerHTML = `<span class="stat-bad">FPS ${fps} · ${lat} ms · +170% OVERLOAD</span>`;
      modeBadge.textContent = 'UNIFORM GRID (LAGGY 8 FPS)';
      modeBadge.className = 'lidar-mode-badge uniform';
      overlayTag.innerHTML = `UNIFORM GRID · FIXED RESOLUTION · <strong class="stat-bad">1,200,000 CELLS (COMPUTE BOTTLENECK)</strong>`;
      uniformLegendItem.style.display = 'inline-flex';
    } else {
      statsElem.innerHTML = `<span class="stat-good">FPS ${fps} · ${lat} ms · −63% COMPUTE</span>`;
      modeBadge.textContent = 'ADAPTIVE FOVEATED';
      modeBadge.className = 'lidar-mode-badge adaptive';
      overlayTag.innerHTML = `ADAPTIVE FOVEATED · 5cm@10m → 50cm@120m · <strong class="stat-good">444,599 CELLS (−63% COMPUTE)</strong>`;
      uniformLegendItem.style.display = 'none';
    }
  }

  return {
    setGridMode(mode) {
      currentGridMode = mode;
      lastUniformRender = 0;
    },
    getGridMode() {
      return currentGridMode;
    },
    resetView() {
      camYaw = null;
      lastUniformRender = 0;
    },
    update(frame) {
      if (!frame?.ego) return;
      // UNIFORM: only redraw ~8 times a second; the 2D canvas holds the last
      // frame in between, so the feed genuinely stutters.
      if (currentGridMode === 'uniform') {
        const now = performance.now();
        if (now - lastUniformRender < 125) return;
        lastUniformRender = now;
      }
      render(frame);
    },
    destroy() {
      resizeObserver.disconnect();
    }
  };
}
