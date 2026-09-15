/**
 * Admin Console — Live LiDAR Feed
 * Raw point-cloud style rendering (scattered classified points, not the
 * filled road/vehicle graphics the main dashboard's PerceptionMap draws)
 * so an admin can see the underlying detection data points directly.
 *
 * The generic "road surface" and "shoulder" point clouds are decorative
 * (this sim has no literal per-point LiDAR data) but fixed relative to
 * ego so they read as a stable road shape rather than flickering noise;
 * the classified clusters around walls/poles/trees/vehicles/humans/
 * hazards are generated fresh each frame from the real frame.objects
 * positions, so what's plotted there does reflect the actual detections.
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
      <span class="lidar-feed-title">LIVE LIDAR FEED</span>
      <span class="lidar-feed-stats font-mono" id="lidar-feed-stats">FPS -- &middot; --ms</span>
    </div>
    <div class="lidar-feed-canvas-wrap">
      <canvas class="lidar-feed-canvas" id="lidar-feed-canvas"></canvas>
    </div>
    <div class="lidar-feed-legend">
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.drivable}"></span>Drivable</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.nondrivable}"></span>Non-Drivable</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.static}"></span>Static (Wall/Pole/Tree)</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.dynamic}"></span>Dynamic (Vehicle/Human)</span>
      <span class="lidar-legend-item"><span class="lidar-dot" style="background:${COLORS.hazard}"></span>Hazard (Curb/Pothole)</span>
    </div>
  `;

  const canvas = container.querySelector('#lidar-feed-canvas');
  const ctx = canvas.getContext('2d');
  const statsElem = container.querySelector('#lidar-feed-stats');
  const canvasWrap = container.querySelector('.lidar-feed-canvas-wrap');

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

    // Faint range-ring gridlines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const rings = 6;
    for (let i = 1; i <= rings; i++) {
      const ry = h - (h / rings) * i;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(w, ry);
      ctx.stroke();
    }

    const scale = h / DEPTH_M;
    const egoX = w / 2;
    const egoY = h - Math.max(20, h * 0.04);
    const toScreen = (x, y) => [egoX + x * scale, egoY - y * scale];

    road.forEach((p) => {
      const [sx, sy] = toScreen(p.x, p.y);
      if (sy < 0 || sy > h) return;
      drawPoint(sx, sy, COLORS.drivable, 1.6);
    });
    shoulder.forEach((p) => {
      const [sx, sy] = toScreen(p.x, p.y);
      if (sy < 0 || sy > h) return;
      drawPoint(sx, sy, COLORS.nondrivable, 1.6);
    });

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

    // Ego marker: white triangle pointing forward
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(egoX, egoY - 10);
    ctx.lineTo(egoX - 8, egoY + 7);
    ctx.lineTo(egoX + 8, egoY + 7);
    ctx.closePath();
    ctx.fill();

    if (frame.metrics) {
      statsElem.textContent = `FPS ${frame.metrics.fps} · ${frame.metrics.latency_ms}ms`;
    }
  }

  return {
    update(frame) {
      if (!frame) return;
      render(frame);
    },
    destroy() {
      resizeObserver.disconnect();
    }
  };
}
