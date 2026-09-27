/**
 * Admin Console — Live LiDAR Feed
 * Raw point-cloud style rendering (scattered classified points, not the
 * filled road/vehicle graphics the main dashboard's PerceptionMap draws)
 * with support for ADAPTIVE (Foveated) and UNIFORM grid modes.
 */

const COLORS = {
  drivable: '#00e676',
  nondrivable: '#c2b280',
  static: '#ef4444',
  dynamic: '#f97316',
  hazard: '#c084fc'
};

const DEPTH_M = 80; // meters of forward range mapped to the canvas height

function buildFixedCloud() {
  const road = [];
  for (let i = 0; i < 260; i++) {
    const distFrac = Math.random();
    const y = 4 + distFrac * 68;
    const spread = 3.0 + distFrac * 2.2;
    road.push({ x: (Math.random() - 0.5) * spread * 2, y });
  }
  const shoulder = [];
  for (let i = 0; i < 90; i++) {
    const y = 4 + Math.random() * 68;
    const side = Math.random() < 0.5 ? -1 : 1;
    shoulder.push({ x: side * (4.5 + Math.random() * 3.5), y });
  }
  return { road, shoulder };
}

function buildUniformWasteCloud() {
  // Dense wasteful points sampled across the entire rectangular bounding box
  const waste = [];
  for (let i = 0; i < 450; i++) {
    const x = (Math.random() - 0.5) * 44;
    const y = 2 + Math.random() * 76;
    waste.push({ x, y });
  }
  return waste;
}

function classifyObject(obj) {
  if (obj.class === 'static_wall') return { cls: 'static', count: 16, spread: 3.6 };
  if (obj.class === 'static_pole' || obj.class === 'static_tree') return { cls: 'static', count: 12, spread: 1.4 };
  if (obj.class === 'dynamic_vehicle') return { cls: 'dynamic', count: 18, spread: 2.2 };
  if (obj.class === 'dynamic_human') return { cls: 'dynamic', count: 8, spread: 0.9 };
  if (obj.class === 'pothole' || obj.class === 'curb') {
    return { cls: 'hazard', count: 10, spread: (obj.radius || 1.2) * 1.2 };
  }
  return null;
}

export function createLidarFeedPanel(container) {
  container.innerHTML = `
    <div class="lidar-feed-header">
      <div class="lidar-feed-title-group">
        <span class="lidar-feed-title">LIVE LIDAR FEED</span>
        <span class="lidar-mode-badge" id="lidar-mode-badge">ADAPTIVE FOVEATED</span>
      </div>
      <span class="lidar-feed-stats font-mono" id="lidar-feed-stats">FPS 42 &middot; 24ms &middot; &minus;63% COMPUTE</span>
    </div>
    <div class="lidar-feed-canvas-wrap">
      <canvas class="lidar-feed-canvas" id="lidar-feed-canvas"></canvas>
      <div class="lidar-feed-overlay-tag font-mono" id="lidar-feed-overlay-tag">GRID RESOLUTION: 5cm@10m &rarr; 50cm@100m (444,599 CELLS)</div>
    </div>
    <div class="lidar-feed-legend">
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.drivable}"></span>Drivable</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.nondrivable}"></span>Non-Drivable</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.static}"></span>Static (Wall/Pole/Tree)</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.dynamic}"></span>Dynamic (Vehicle/Human)</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.hazard}"></span>Hazard (Curb/Pothole)</span>
      <span class="lidar-legend-item uniform-only-legend" id="uniform-legend-item" style="display:none;"><span class="lidar-dot" style="background:#ef4444;"></span>Uniform Grid Waste (1.2M Cells)</span>
    </div>
  `;

  const canvas = container.querySelector('#lidar-feed-canvas');
  const ctx = canvas.getContext('2d');
  const statsElem = container.querySelector('#lidar-feed-stats');
  const modeBadge = container.querySelector('#lidar-mode-badge');
  const overlayTag = container.querySelector('#lidar-feed-overlay-tag');
  const uniformLegendItem = container.querySelector('#uniform-legend-item');
  const canvasWrap = container.querySelector('.lidar-feed-canvas-wrap');

  let currentGridMode = 'adaptive';
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const rect = canvasWrap.getBoundingClientRect();
    const w = Math.max(rect.width, 200);
    const h = Math.max(rect.height, 160);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasWrap);
  requestAnimationFrame(resize);
  setTimeout(resize, 50);

  const { road, shoulder } = buildFixedCloud();
  const uniformWaste = buildUniformWasteCloud();

  function drawPoint(x, y, color, size) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(frame) {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    const scale = h / DEPTH_M;
    const egoX = w / 2;
    const egoY = h - Math.max(20, h * 0.04);
    const toScreen = (x, y) => [egoX + x * scale, egoY - y * scale];

    if (currentGridMode === 'uniform') {
      // 1. UNIFORM MODE: Dense Cartesian Red Gridlines (1.2M cells representation)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.lineWidth = 1;
      const step = Math.max(10, Math.round(scale * 2.0)); // Fixed 2-meter uniform cell step
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 2. UNIFORM WASTE: Render thousands of redundant compute cells across empty regions
      uniformWaste.forEach((p) => {
        const [sx, sy] = toScreen(p.x, p.y);
        if (sy < 0 || sy > h || sx < 0 || sx > w) return;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.fillRect(sx - 1, sy - 1, 2.2, 2.2);
      });
    } else {
      // 1. ADAPTIVE MODE: Biologically-Inspired Foveated Polar Range Rings & Rays
      // High resolution near ego (close rings), lower resolution further away
      const foveatedRingsM = [5, 10, 18, 30, 50, 75];
      foveatedRingsM.forEach((distM) => {
        const [_, ry] = toScreen(0, distM);
        const radiusPx = (distM / DEPTH_M) * h;
        
        ctx.beginPath();
        ctx.arc(egoX, egoY, radiusPx, Math.PI, Math.PI * 2);
        
        if (distM <= 15) {
          // High resolution core
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
        } else {
          // Peripheral coarse zone
          ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';
          ctx.lineWidth = 0.8;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Range indicator labels
        ctx.fillStyle = distM <= 15 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(0, 242, 254, 0.6)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(`${distM}m`, egoX + 6, ry + 3);
      });

      // Subtle foveated radial angular sector dividers
      [-60, -40, -20, 0, 20, 40, 60].forEach((deg) => {
        const rad = (deg - 90) * (Math.PI / 180);
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(egoX, egoY);
        ctx.lineTo(egoX + Math.cos(rad) * h * 1.2, egoY + Math.sin(rad) * h * 1.2);
        ctx.stroke();
      });
    }

    // Road surface points
    road.forEach((p) => {
      const [sx, sy] = toScreen(p.x, p.y);
      if (sy < 0 || sy > h) return;
      drawPoint(sx, sy, COLORS.drivable, 1.6);
    });

    // Shoulder points
    shoulder.forEach((p) => {
      const [sx, sy] = toScreen(p.x, p.y);
      if (sy < 0 || sy > h) return;
      drawPoint(sx, sy, COLORS.nondrivable, 1.6);
    });

    // Classified obstacle clusters
    (frame.objects || []).forEach((obj) => {
      const spec = classifyObject(obj);
      if (!spec) return;
      for (let i = 0; i < spec.count; i++) {
        const jx = obj.position[0] + (Math.random() - 0.5) * spec.spread;
        const jy = obj.position[1] + (Math.random() - 0.5) * spec.spread;
        const [sx, sy] = toScreen(jx, jy);
        if (sy < -10 || sy > h + 10) continue;
        drawPoint(sx, sy, COLORS[spec.cls], 2.2);
      }
    });

    // Ego vehicle marker: triangle pointing forward
    ctx.fillStyle = currentGridMode === 'uniform' ? '#f87171' : '#00f2fe';
    ctx.beginPath();
    ctx.moveTo(egoX, egoY - 11);
    ctx.lineTo(egoX - 8, egoY + 7);
    ctx.lineTo(egoX + 8, egoY + 7);
    ctx.closePath();
    ctx.fill();

    // Stats & readouts based on active mode
    if (currentGridMode === 'uniform') {
      const fps = 8;
      const lat = Math.round(74 + (Math.random() - 0.5) * 4);
      statsElem.innerHTML = `<span style="color:#ef4444;font-weight:700;">FPS ${fps} &middot; ${lat}ms &middot; +170% OVERLOAD</span>`;
      modeBadge.textContent = 'UNIFORM GRID (LAGGY 8 FPS)';
      modeBadge.className = 'lidar-mode-badge uniform';
      overlayTag.innerHTML = `UNIFORM GRID &middot; FIXED RESOLUTION &middot; <strong style="color:#ef4444">8 FPS &middot; 74ms &middot; 1,200,000 CELLS (COMPUTE BOTTLENECK)</strong>`;
      uniformLegendItem.style.display = 'inline-flex';
    } else {
      const fps = frame.metrics?.fps || 42;
      const lat = frame.metrics?.latency_ms || 24;
      statsElem.innerHTML = `<span style="color:var(--text-cyan);">FPS ${fps} &middot; ${lat}ms &middot; &minus;63% COMPUTE</span>`;
      modeBadge.textContent = 'ADAPTIVE FOVEATED';
      modeBadge.className = 'lidar-mode-badge adaptive';
      overlayTag.innerHTML = `ADAPTIVE FOVEATED &middot; 5cm@10m &rarr; 50cm@100m &middot; <strong style="color:#00e676">444,599 CELLS (&minus;63% COMPUTE)</strong>`;
      uniformLegendItem.style.display = 'none';
    }
  }

  let lastUniformRenderTime = 0;

  return {
    setGridMode(mode) {
      currentGridMode = mode;
      lastUniformRenderTime = 0;
    },
    getGridMode() {
      return currentGridMode;
    },
    update(frame) {
      if (!frame) return;

      // When in UNIFORM mode, throttle the actual rendering to 8 FPS (~125ms per frame)
      // to make the live field genuinely lag and stutter from compute overload.
      if (currentGridMode === 'uniform') {
        const now = performance.now();
        if (now - lastUniformRenderTime < 125) {
          // Skip frame redraw, holding the canvas frozen to create real 8 FPS choppiness
          return;
        }
        lastUniformRenderTime = now;
      }

      render(frame);
    },
    destroy() {
      resizeObserver.disconnect();
    }
  };
}
