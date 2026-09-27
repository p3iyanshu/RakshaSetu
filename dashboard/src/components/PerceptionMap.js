/**
 * PerceptionMap Component
 * 2.5D perspective LiDAR perception view for RakshaSetu (SIH PS 26053 · DRDO).
 *
 * Layers (bottom -> top):
 *   1. WebGL scene   - terrain heightfield with concentric contour rings,
 *                      4-lane carriageway, foveated drivable grid, 3D objects
 *   2. 2D overlay    - planned path, velocity vectors, selection brackets,
 *                      range-ring labels, callout leader lines
 *   3. HTML          - object callouts, road/terrain HUD, minimap, view controls
 */

import { createSceneRenderer } from '../render/sceneRenderer.js';
import { projectPoint } from '../render/glUtils.js';
import { SEMANTIC_COLORS } from '../lib/colors.js';
import {
  TERRAIN, CENTERLINE, ALTITUDE_DATUM_M, terrainHeight
} from '../lib/roadNetwork.js';

const CLASS_COLOR = {
  dynamic_vehicle: SEMANTIC_COLORS.dynamic_vehicle,
  dynamic_human: SEMANTIC_COLORS.dynamic_human,
  static_pole: SEMANTIC_COLORS.static_pole,
  static_wall: SEMANTIC_COLORS.static_wall,
  static_tree: SEMANTIC_COLORS.static_tree,
  pothole: SEMANTIC_COLORS.pothole,
  curb: SEMANTIC_COLORS.curb,
  unclassified: '#94a3b8'
};
const CARD_CLASSES = new Set(['dynamic_vehicle', 'dynamic_human', 'pothole', 'unclassified']);
const RING_RADII = [10, 30, 60, 120];

export function createPerceptionMap(container, onSelectObject) {
  container.innerHTML = `
    <div class="map-viewport-container" id="map-viewport">
      <canvas class="perception-gl"></canvas>
      <canvas class="perception-overlay"></canvas>
      <div class="map-overlay-layer"></div>
      <div class="map-hover-tooltip" style="display: none;"></div>

      <div class="map-hud map-hud-top-left">
        <div class="hud-title">
          <span class="hud-live-dot"></span>LIVE 2.5D SCENE
          <span class="hud-mode" data-ref="mode-label">PERSPECTIVE</span>
        </div>
        <div class="hud-grid">
          <span>Curve</span><b data-ref="curve">—</b>
          <span>Grade</span><b data-ref="grade">—</b>
          <span>Lane</span><b data-ref="lane">—</b>
          <span>Altitude</span><b data-ref="alt">—</b>
        </div>
      </div>

      <div class="map-hud map-hud-top-right">
        <div class="minimap-head">
          <span>ROUTE OVERVIEW</span><span class="minimap-n">N ▲</span>
        </div>
        <canvas class="minimap-canvas" width="200" height="170"></canvas>
      </div>

      <div class="map-hud map-hud-bottom-left">
        <div class="compass-widget" title="Map is heading-up; needle points north">
          <div class="compass-rose" data-ref="rose">
            <span class="compass-n">N</span>
            <span class="compass-e">E</span>
            <span class="compass-s">S</span>
            <span class="compass-w">W</span>
            <div class="compass-needle"></div>
          </div>
        </div>
        <div class="view-controls">
          <div class="seg-group" role="group" aria-label="Camera view">
            <button class="seg-btn active" data-view="2.5D">2.5D</button>
            <button class="seg-btn" data-view="TOP">TOP</button>
            <button class="seg-btn" data-view="CHASE">CHASE</button>
          </div>
          <div class="seg-group" role="group" aria-label="Layers">
            <button class="seg-btn active" data-layer="points" title="LiDAR point returns">PTS</button>
            <button class="seg-btn active" data-layer="grid" title="Foveated drivable grid">GRID</button>
            <button class="seg-btn" data-zoom="in" title="Zoom in">+</button>
            <button class="seg-btn" data-zoom="out" title="Zoom out">−</button>
          </div>
        </div>
      </div>

      <div class="map-hud map-hud-bottom-right">
        <div class="legend-row">
          <span class="legend-label">TERRAIN</span>
          <div class="hypso-bar"></div>
        </div>
        <div class="hypso-ticks">
          <span>${Math.round(ALTITUDE_DATUM_M + TERRAIN.minZ)}</span>
          <span>${Math.round(ALTITUDE_DATUM_M + (TERRAIN.minZ + TERRAIN.maxZ) / 2)}</span>
          <span>${Math.round(ALTITUDE_DATUM_M + TERRAIN.maxZ)} m</span>
        </div>
        <div class="legend-notes">
          <span><i class="ln ln-minor"></i>Contour 5 m</span>
          <span><i class="ln ln-major"></i>Index 25 m</span>
          <span><i class="ln ln-ring"></i>Range 10·30·60·120 m</span>
        </div>
      </div>

      <div class="map-fallback" style="display:none">
        WebGL2 is unavailable in this browser — the 2.5D scene needs a GPU-enabled browser.
      </div>
    </div>
  `;

  const $ = (sel) => container.querySelector(sel);
  const glCanvas = $('.perception-gl');
  const overlay = $('.perception-overlay');
  const octx = overlay.getContext('2d');
  const calloutLayer = $('.map-overlay-layer');
  const tooltip = $('.map-hover-tooltip');
  const refs = {};
  container.querySelectorAll('[data-ref]').forEach(el => { refs[el.dataset.ref] = el; });

  let renderer = null;
  try {
    renderer = createSceneRenderer(glCanvas);
  } catch (err) {
    console.error('[PerceptionMap] WebGL init failed', err);
  }
  if (!renderer) $('.map-fallback').style.display = 'flex';

  const minimap = createMinimap($('.minimap-canvas'));

  let currentFrame = null;
  let selectedObjectId = '04';
  let cssW = 800, cssH = 600, dpr = 1;
  let projected = [];   // [{obj, x, y, top}] from the last render, for picking

  function resize() {
    const rect = container.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(rect.width, 200);
    cssH = Math.max(rect.height, 200);
    for (const c of [glCanvas, overlay]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ---- Controls ------------------------------------------------------------
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!renderer) return;
      renderer.setMode(btn.dataset.view);
      container.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === btn));
      refs['mode-label'].textContent = { '2.5D': 'PERSPECTIVE', TOP: 'ORTHO TOP', CHASE: 'CHASE CAM' }[btn.dataset.view];
    });
  });
  container.querySelectorAll('[data-layer]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!renderer) return;
      const key = btn.dataset.layer === 'points' ? 'showPoints' : 'showGrid';
      renderer.settings[key] = !renderer.settings[key];
      btn.classList.toggle('active', renderer.settings[key]);
    });
  });
  container.querySelectorAll('[data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => renderer && renderer.zoomBy(btn.dataset.zoom === 'in' ? 0.8 : 1.25));
  });
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (renderer) renderer.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
  }, { passive: false });

  // Drag to orbit, double-click to reset
  let drag = null;
  overlay.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, moved: false }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag || !renderer) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 2) drag.moved = true;
    renderer.orbit(-dx * 0.006);
    drag.x = e.clientX;
  });
  window.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }, 0); });
  overlay.addEventListener('dblclick', () => renderer && renderer.resetView());

  // ---- Picking -------------------------------------------------------------
  function pick(mx, my) {
    let best = null, bestD = 30;
    for (const p of projected) {
      const d = Math.min(Math.hypot(mx - p.x, my - p.y), Math.hypot(mx - p.top.x, my - p.top.y));
      if (d < bestD) { bestD = d; best = p.obj; }
    }
    return best;
  }

  overlay.addEventListener('click', (e) => {
    if (drag && drag.moved) return;
    const r = overlay.getBoundingClientRect();
    const obj = pick(e.clientX - r.left, e.clientY - r.top);
    if (obj) select(obj.track_id);
  });

  overlay.addEventListener('mousemove', (e) => {
    const r = overlay.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const obj = pick(mx, my);
    overlay.style.cursor = obj ? 'pointer' : (drag ? 'grabbing' : 'grab');
    if (!obj) { tooltip.style.display = 'none'; return; }
    tooltip.style.display = 'flex';
    tooltip.style.left = `${mx + 14}px`;
    tooltip.style.top = `${my - 10}px`;
    tooltip.innerHTML = `
      <span class="tooltip-title">${obj.name}</span>
      <span class="tooltip-class">${obj.ui_class || obj.class}</span>
      <span class="tooltip-dist font-mono">${obj.distance_m.toFixed(1)} m · ${obj.velocity_mps.toFixed(1)} m/s</span>`;
  });
  overlay.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  function select(id) {
    selectedObjectId = String(id);
    const obj = currentFrame?.objects.find(o => String(o.track_id) === selectedObjectId);
    if (obj && onSelectObject) onSelectObject(obj);
  }

  // ---- Callouts (DOM nodes are reused across frames) ----------------------
  const calloutNodes = new Map();
  const labelSize = new Map();
  calloutLayer.addEventListener('click', (e) => {
    const el = e.target.closest('[data-id]');
    if (el) select(el.dataset.id);
  });

  function updateCallouts(items) {
    const seen = new Set();
    for (const it of items) {
      const { obj, anchor, compact } = it;
      const id = String(obj.track_id);
      seen.add(id);
      let el = calloutNodes.get(id);
      const kind = compact ? 'tag' : 'card';
      if (!el || el.dataset.kind !== kind) {
        if (el) el.remove();
        el = document.createElement('div');
        el.dataset.id = id;
        el.dataset.kind = kind;
        el.className = compact ? 'map-tag' : 'map-callout-card';
        calloutLayer.appendChild(el);
        calloutNodes.set(id, el);
      }
      const color = CLASS_COLOR[obj.class] || '#94a3b8';
      el.style.setProperty('--tag-color', color);
      el.classList.toggle('is-selected', it.selected);
      el.style.transform = `translate(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px)`;
      const html = compact
        ? `${obj.name}`
        : `<div class="callout-header">${obj.name}</div>
           <div class="callout-stats font-mono">
             <span>${obj.distance_m.toFixed(1)} m</span>
             <span>${obj.velocity_mps.toFixed(1)} m/s</span>
             <span>${obj.confidence}%</span>
           </div>`;
      if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
        labelSize.set(id + (compact ? 't' : 'c'), { w: el.offsetWidth, h: el.offsetHeight });
      }
    }
    for (const [id, el] of calloutNodes) {
      if (!seen.has(id)) { el.remove(); calloutNodes.delete(id); }
    }
  }

  // ---- Per-frame render -----------------------------------------------------
  function render() {
    if (!currentFrame || !renderer) return;
    const frame = currentFrame;
    const cam = renderer.render(frame, selectedObjectId);
    const M = cam.viewProj;
    const P = (x, y, z) => projectPoint(M, x, y, z, cssW, cssH);

    octx.clearRect(0, 0, cssW, cssH);
    const ego = frame.ego;

    // Planned trajectory ribbon
    if (frame.plannedPath) {
      octx.save();
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      const pts = frame.plannedPath.map(p => P(p[0], p[1], p[2])).filter(Boolean);
      if (pts.length > 1) {
        const grad = octx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        grad.addColorStop(0, 'rgba(0, 242, 254, 0.85)');
        grad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
        octx.strokeStyle = grad;
        octx.lineWidth = 2.2;
        octx.setLineDash([7, 5]);
        octx.beginPath();
        pts.forEach((p, i) => (i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y)));
        octx.stroke();
      }
      octx.restore();
    }

    // Range ring labels, placed on the ring along the camera's right vector
    octx.save();
    octx.font = '600 10px "JetBrains Mono", monospace';
    octx.textAlign = 'left';
    octx.textBaseline = 'middle';
    for (const r of RING_RADII) {
      const a = cam.yaw + cam.orbitYaw - 0.55;
      const lx = ego.x + Math.cos(a) * r, ly = ego.y + Math.sin(a) * r;
      const p = P(lx, ly, terrainHeight(lx, ly) + 0.3);
      if (!p || p.x < 0 || p.x > cssW - 40 || p.y < 0 || p.y > cssH) continue;
      const label = `${r} m`;
      const w = octx.measureText(label).width + 8;
      octx.fillStyle = 'rgba(3, 8, 14, 0.72)';
      octx.fillRect(p.x - 2, p.y - 7, w, 14);
      octx.fillStyle = 'rgba(0, 242, 254, 0.9)';
      octx.fillText(label, p.x + 2, p.y);
    }
    octx.restore();

    // Objects: vectors, selection brackets, callout anchors
    projected = [];
    const labelItems = [];
    for (const obj of frame.objects) {
      const w = obj.world;
      if (!w) continue;
      const h = obj.bbox?.h ?? 1;
      const base = P(w.x, w.y, w.z + Math.min(h, 1.2) * 0.5);
      const top = P(w.x, w.y, w.z + h + 0.4);
      if (!base || !top) continue;
      if (base.x < -60 || base.x > cssW + 60 || base.y < -60 || base.y > cssH + 60) continue;
      projected.push({ obj, x: base.x, y: base.y, top });
      const selected = String(obj.track_id) === String(selectedObjectId);
      const color = CLASS_COLOR[obj.class] || '#94a3b8';

      // Velocity vector (1.5 s horizon) for moving objects
      if (obj.is_dynamic && obj.velocity_mps > 0.2) {
        const len = obj.velocity_mps * 1.5;
        const ex = w.x + Math.cos(w.yaw) * len, ey = w.y + Math.sin(w.yaw) * len;
        const a = P(w.x, w.y, w.z + 0.1), b = P(ex, ey, w.z + 0.1);
        if (a && b) drawArrow(octx, a, b, color);
      }

      if (selected) drawSelectionBox(octx, obj, P);

      const important = CARD_CLASSES.has(obj.class);
      if (selected || (important && obj.distance_m < 95) || (!important && obj.distance_m < 55)) {
        labelItems.push({ obj, top, selected, compact: !selected && !important });
      }
    }

    // Declutter: nearest full cards first, cap the count
    labelItems.sort((a, b) => (b.selected - a.selected) || (a.obj.distance_m - b.obj.distance_m));
    let cards = 0;
    // HUD panels are obstacles for label placement
    const vp = container.getBoundingClientRect();
    const placed = [...container.querySelectorAll('.map-hud')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left - vp.left - 4, y: r.top - vp.top - 4, w: r.width + 8, h: r.height + 8 };
    });
    const finalItems = [];
    for (const it of labelItems) {
      if (!it.compact && !it.selected && cards >= 6) it.compact = true;
      const size = labelSize.get(String(it.obj.track_id) + (it.compact ? 't' : 'c'));
      const wEst = size ? size.w : (it.compact ? 70 : 130), hEst = size ? size.h : (it.compact ? 18 : 36);
      let ax = it.top.x + 12, ay = it.top.y - hEst - 10;
      // Nudge upward if colliding with an already placed label
      ax = Math.min(Math.max(ax, 4), cssW - wEst - 4);
      ay = Math.min(Math.max(ay, 4), cssH - hEst - 4);
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find(r => ax < r.x + r.w && ax + wEst > r.x && ay < r.y + r.h && ay + hEst > r.y);
        if (!hit) break;
        // Move above the obstacle, or below it when there is no room above
        ay = hit.y - hEst - 4 >= 4 ? hit.y - hEst - 4 : hit.y + hit.h + 4;
      }
      const stillHit = placed.some(r => ax < r.x + r.w && ax + wEst > r.x && ay < r.y + r.h && ay + hEst > r.y);
      if (stillHit && !it.selected) continue;   // no free slot: drop the label, keep the 3D object
      placed.push({ x: ax, y: ay, w: wEst, h: hEst });
      if (!it.compact) cards++;
      // Leader line from object top to the label corner
      octx.strokeStyle = CLASS_COLOR[it.obj.class] || '#94a3b8';
      octx.globalAlpha = it.selected ? 0.95 : 0.55;
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(it.top.x, it.top.y);
      octx.lineTo(ax, ay + hEst);
      octx.stroke();
      octx.globalAlpha = 1;
      finalItems.push({ ...it, anchor: { x: ax, y: ay } });
    }
    updateCallouts(finalItems);

    // HUD readouts
    if (frame.road) {
      const rd = frame.road;
      refs.curve.textContent = rd.turn === 'Straight' ? 'Straight' : `R ${rd.radius_m} m ${rd.turn.toUpperCase()}`;
      refs.grade.textContent = `${rd.grade_pct > 0 ? '+' : ''}${rd.grade_pct.toFixed(1)} %`;
      refs.lane.textContent = rd.lane;
      refs.alt.textContent = `${frame.scene.altitude_m} m MSL`;
    }
    const yawDeg = (cam.yaw + cam.orbitYaw) * 180 / Math.PI;
    refs.rose.style.transform = `rotate(${yawDeg - 90}deg)`;
    minimap.draw(frame, cam);
  }

  return {
    update(frame, selectedId) {
      currentFrame = frame;
      if (selectedId !== undefined) selectedObjectId = String(selectedId);
      render();
    },
    destroy() {}
  };
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------
function drawArrow(ctx, a, b, color) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;
  const ux = dx / len, uy = dy / len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x - ux * 5, b.y - uy * 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - ux * 7 - uy * 4, b.y - uy * 7 + ux * 4);
  ctx.lineTo(b.x - ux * 7 + uy * 4, b.y - uy * 7 - ux * 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Projected 3D bounding box with corner brackets for the selected object. */
function drawSelectionBox(ctx, obj, P) {
  const w = obj.world;
  const b = obj.bbox || { l: 1, w: 1, h: 1 };
  const l = obj.class === 'pothole' ? 2.8 : b.l + 0.4;
  const wd = obj.class === 'pothole' ? 2.4 : b.w + 0.4;
  const h = obj.class === 'pothole' ? 0.3 : b.h + 0.2;
  const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
  const corners = [];
  for (const [fx, fy] of [[l / 2, wd / 2], [l / 2, -wd / 2], [-l / 2, -wd / 2], [-l / 2, wd / 2]]) {
    const x = w.x + c * fx - s * fy, y = w.y + s * fx + c * fy;
    corners.push([x, y]);
  }
  const bottom = corners.map(([x, y]) => P(x, y, w.z + 0.05));
  const top = corners.map(([x, y]) => P(x, y, w.z + h));
  if (bottom.some(p => !p) || top.some(p => !p)) return;
  ctx.save();
  ctx.strokeStyle = '#00f2fe';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(0, 242, 254, 0.8)';
  ctx.shadowBlur = 6;
  const poly = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  };
  ctx.globalAlpha = 0.9;
  poly(bottom);
  poly(top);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) { ctx.moveTo(bottom[i].x, bottom[i].y); ctx.lineTo(top[i].x, top[i].y); }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Minimap: north-up overview with terrain, contours, route and ego wedge
// ---------------------------------------------------------------------------
function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < CENTERLINE.count; i++) {
    minX = Math.min(minX, CENTERLINE.xs[i]); maxX = Math.max(maxX, CENTERLINE.xs[i]);
    minY = Math.min(minY, CENTERLINE.ys[i]); maxY = Math.max(maxY, CENTERLINE.ys[i]);
  }
  const pad = 70;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const toPx = (x, y) => [ox + (x - minX) * scale, H - (oy + (y - minY) * scale)];

  // Pre-render base layer
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(W, H);
  const span = TERRAIN.maxZ - TERRAIN.minZ;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = minX + (px - ox) / scale;
      const y = minY + (H - py - oy) / scale;
      const z = terrainHeight(x, y);
      const zx = terrainHeight(x + 4, y) - terrainHeight(x - 4, y);
      const zy = terrainHeight(x, y + 4) - terrainHeight(x, y - 4);
      const shade = Math.max(0.35, Math.min(1.35, 0.9 + (-zx + zy) * 0.06));
      const t = (z - TERRAIN.minZ) / span;
      const c = [18 + t * 70, 30 + t * 55, 26 + t * 45];
      const contour = Math.abs(((z / 10) % 1 + 1) % 1 - 0.5) > 0.44 ? 1 : 0;
      const o = (py * W + px) * 4;
      img.data[o] = Math.min(255, c[0] * shade + contour * 22);
      img.data[o + 1] = Math.min(255, c[1] * shade + contour * 45);
      img.data[o + 2] = Math.min(255, c[2] * shade + contour * 48);
      img.data[o + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  bctx.lineJoin = 'round';
  const route = () => {
    bctx.beginPath();
    for (let i = 0; i <= CENTERLINE.count; i += 3) {
      const k = i % CENTERLINE.count;
      const [px, py] = toPx(CENTERLINE.xs[k], CENTERLINE.ys[k]);
      i ? bctx.lineTo(px, py) : bctx.moveTo(px, py);
    }
    bctx.closePath();
  };
  bctx.strokeStyle = 'rgba(8, 12, 18, 0.9)';
  bctx.lineWidth = 5;
  route(); bctx.stroke();
  bctx.strokeStyle = '#8b98a8';
  bctx.lineWidth = 2.4;
  route(); bctx.stroke();

  return {
    draw(frame, cam) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      const e = frame.ego;
      const [ex, ey] = toPx(e.x, e.y);
      const yaw = cam.yaw + cam.orbitYaw;
      // View wedge
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-yaw);
      ctx.fillStyle = 'rgba(0, 242, 254, 0.16)';
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(160 * scale, -85 * scale);
      ctx.lineTo(160 * scale, 85 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Tracked objects
      for (const o of frame.objects) {
        if (!o.world) continue;
        const [px, py] = toPx(o.world.x, o.world.y);
        ctx.fillStyle = CLASS_COLOR[o.class] || '#94a3b8';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      // Ego marker
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-e.yaw);
      ctx.fillStyle = '#00f2fe';
      ctx.strokeStyle = '#03101a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, 4.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, -4.5);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
  };
}
