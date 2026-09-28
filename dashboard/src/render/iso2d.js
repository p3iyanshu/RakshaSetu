/**
 * Lightweight 2.5D (oblique orthographic) renderer for the side panels.
 *
 * Canvas 2D only, so every widget stays cheap and there is a single WebGL
 * context on the page (the main perception scene). World frame matches the
 * scene: x forward, y left, z up (metres); the view is rotated by `yaw`
 * and tilted by `pitch` (0 = side-on, 90 = straight down).
 */

export function createIsoView({ cx, cy, scale, yaw = 0.6, pitch = 32, zScale = 1 }) {
  const view = { cx, cy, scale, yaw, pitch, zScale };
  view.project = (x, y, z) => {
    const c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    const xr = x * c - y * s;          // screen right
    const yr = x * s + y * c;          // into the screen
    const p = view.pitch * Math.PI / 180;
    return {
      x: view.cx + xr * view.scale,
      y: view.cy - yr * view.scale * Math.sin(p) - z * view.zScale * view.scale * Math.cos(p),
      depth: yr * Math.cos(p) - z * Math.sin(p) * 0.001
    };
  };
  return view;
}

/** Fit the canvas backing store to its CSS size at device pixel ratio. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const LIGHT = normalize([-0.45, 0.35, 0.82]);

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function shade(hex, k) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((v >> 8) & 255) * k));
  const b = Math.min(255, Math.round((v & 255) * k));
  return `rgb(${r},${g},${b})`;
}

/**
 * Box primitive in world space. Faces are depth-sorted by the caller via
 * drawBoxes(); within a box only camera-facing faces are drawn.
 */
export function box(x, y, z, l, w, h, color, opts = {}) {
  return { x, y, z, l, w, h, color, yaw: opts.yaw || 0, stroke: opts.stroke, alpha: opts.alpha ?? 1, glow: opts.glow };
}

export function drawBoxes(ctx, view, boxes) {
  const withDepth = boxes.map(b => ({ b, d: view.project(b.x, b.y, b.z + b.h / 2).depth }));
  withDepth.sort((a, c) => c.d - a.d);
  for (const { b } of withDepth) drawBox(ctx, view, b);
}

export function drawBox(ctx, view, b) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const hl = b.l / 2, hw = b.w / 2;
  const corner = (fx, fy, fz) => view.project(b.x + c * fx - s * fy, b.y + s * fx + c * fy, b.z + fz);
  const faces = [
    { n: [0, 0, 1], pts: [[-hl, -hw, b.h], [hl, -hw, b.h], [hl, hw, b.h], [-hl, hw, b.h]] },
    { n: [1, 0, 0], pts: [[hl, -hw, 0], [hl, hw, 0], [hl, hw, b.h], [hl, -hw, b.h]] },
    { n: [-1, 0, 0], pts: [[-hl, hw, 0], [-hl, -hw, 0], [-hl, -hw, b.h], [-hl, hw, b.h]] },
    { n: [0, 1, 0], pts: [[hl, hw, 0], [-hl, hw, 0], [-hl, hw, b.h], [hl, hw, b.h]] },
    { n: [0, -1, 0], pts: [[-hl, -hw, 0], [hl, -hw, 0], [hl, -hw, b.h], [-hl, -hw, b.h]] }
  ];
  // View direction in world: rotate (0, 1) "into screen" back by yaw
  const vy = view.yaw;
  const p = view.pitch * Math.PI / 180;
  const into = [Math.sin(vy) * Math.cos(p), Math.cos(vy) * Math.cos(p), -Math.sin(p)];
  ctx.save();
  ctx.globalAlpha = b.alpha;
  for (const f of faces) {
    const nw = [c * f.n[0] - s * f.n[1], s * f.n[0] + c * f.n[1], f.n[2]];
    const facing = nw[0] * into[0] + nw[1] * into[1] + nw[2] * into[2];
    if (facing >= -1e-4) continue;
    const lit = Math.max(0, nw[0] * LIGHT[0] + nw[1] * LIGHT[1] + nw[2] * LIGHT[2]);
    ctx.fillStyle = shade(b.color, 0.45 + 0.75 * lit);
    ctx.beginPath();
    f.pts.forEach(([fx, fy, fz], i) => {
      const q = corner(fx, fy, fz);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fill();
    if (b.stroke) {
      ctx.strokeStyle = b.stroke;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Flat polygon on a horizontal plane at height z. */
export function drawGroundPoly(ctx, view, pts, z, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const q = view.project(x, y, z);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

/** Ellipse/ring on the ground plane, sampled as a polygon. */
export function groundCircle(r, n = 48, rx = r) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, Math.sin(a) * r]);
  }
  return pts;
}

/** Small isometric cube as an inline SVG (legend / event markers). */
export function isoCubeSVG(color, size = 12) {
  const top = shadeHex(color, 1.15), left = shadeHex(color, 0.8), right = shadeHex(color, 0.55);
  return `<svg class="iso-cube" width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1 L11 3.8 L6 6.6 L1 3.8 Z" fill="${top}"/>
    <path d="M1 3.8 L6 6.6 L6 11.5 L1 8.7 Z" fill="${left}"/>
    <path d="M11 3.8 L6 6.6 L6 11.5 L11 8.7 Z" fill="${right}"/>
  </svg>`;
}

function shadeHex(hex, k) {
  const v = parseInt(hex.replace('#', ''), 16);
  const ch = (x) => Math.max(0, Math.min(255, Math.round(x * k))).toString(16).padStart(2, '0');
  return `#${ch((v >> 16) & 255)}${ch((v >> 8) & 255)}${ch(v & 255)}`;
}
