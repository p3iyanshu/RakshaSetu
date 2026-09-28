/**
 * WebGL2 2.5D perception scene: terrain heightfield with contour rings,
 * the 4-lane carriageway, roadside scenery and live tracked objects.
 */

import { createProgram, perspective, viewFromBasis, multiply, hexToRgb } from './glUtils.js';
import { TERRAIN_VS, TERRAIN_FS, ROAD_VS, ROAD_FS, INST_VS, INST_FS } from './shaders.js';
import {
  TERRAIN, CENTERLINE, ROAD, TRACK_LENGTH, roadToWorld, sampleTrack, terrainHeight, hash2
} from '../lib/roadNetwork.js';

const BG = [0.020, 0.031, 0.047];
const LIGHT = [-0.5, 0.5, 0.72];           // NW sun, 45° altitude (cartographic convention)
const BANDS = [10, 30, 60, 120];
const INST_STRIDE = 12;                    // pos3 size3 yaw1 color4 emissive1

const VEHICLE_PAINT = {
  amber: '#c98a2a', olive: '#5f6a3a', slate: '#4a5868', white: '#c9ced4', red: '#9b3a31'
};

// ---------------------------------------------------------------------------
// Mesh builders (local frame: x forward, y left, z up)
// ---------------------------------------------------------------------------
function pushTri(out, a, b, c, color) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const col = color || [1, 1, 1, 0];
  for (const p of [a, b, c]) out.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], col[3]);
}

function boxMesh(out = [], x0 = -0.5, x1 = 0.5, y0 = -0.5, y1 = 0.5, z0 = 0, z1 = 1, color) {
  const v = (x, y, z) => [x, y, z];
  const q = (a, b, c, d) => { pushTri(out, a, b, c, color); pushTri(out, a, c, d, color); };
  q(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)); // top
  q(v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0), v(x0, y0, z0)); // bottom
  q(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)); // front
  q(v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1)); // back
  q(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)); // right
  q(v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1)); // left
  return out;
}

function coneMesh(out, z0, z1, r, seg, color) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, Math.sin(a0) * r, z0];
    const p1 = [Math.cos(a1) * r, Math.sin(a1) * r, z0];
    pushTri(out, p0, p1, [0, 0, z1], color);
    pushTri(out, p1, p0, [0, 0, z0], color);
  }
  return out;
}

function treeMesh() {
  const out = [];
  boxMesh(out, -0.06, 0.06, -0.06, 0.06, 0, 0.3, [0.24, 0.16, 0.09, 1]);   // trunk
  coneMesh(out, 0.18, 0.72, 0.5, 7);
  coneMesh(out, 0.45, 1.0, 0.34, 7);
  return out;
}

function rockMesh() {
  const out = [];
  const top = [0.05, -0.08, 1], bottom = [0, 0, 0];
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = 0.5 * (0.8 + 0.2 * Math.sin(i * 2.7));
    ring.push([Math.cos(a) * r, Math.sin(a) * r, 0.42 + 0.1 * Math.cos(i * 1.9)]);
  }
  for (let i = 0; i < 6; i++) {
    const a = ring[i], b = ring[(i + 1) % 6];
    pushTri(out, a, b, top);
    pushTri(out, b, a, bottom);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
export function createSceneRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;

  const terrainProg = createProgram(gl, TERRAIN_VS, TERRAIN_FS);
  const roadProg = createProgram(gl, ROAD_VS, ROAD_FS);
  const instProg = createProgram(gl, INST_VS, INST_FS);

  // ---- Terrain mesh ------------------------------------------------------
  const terrain = (() => {
    const { width: W, height: H, cell, x0, y0, heights, roadDist } = TERRAIN;
    const data = new Float32Array(W * H * 7);
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx;
        const hL = heights[gy * W + Math.max(0, gx - 1)], hR = heights[gy * W + Math.min(W - 1, gx + 1)];
        const hD = heights[Math.max(0, gy - 1) * W + gx], hU = heights[Math.min(H - 1, gy + 1) * W + gx];
        let nx = (hL - hR), ny = (hD - hU), nz = 2 * cell;
        const len = Math.hypot(nx, ny, nz);
        const o = i * 7;
        data[o] = x0 + gx * cell; data[o + 1] = y0 + gy * cell; data[o + 2] = heights[i];
        data[o + 3] = nx / len; data[o + 4] = ny / len; data[o + 5] = nz / len;
        data[o + 6] = roadDist[i];
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let k = 0;
    for (let gy = 0; gy < H - 1; gy++) {
      for (let gx = 0; gx < W - 1; gx++) {
        const a = gy * W + gx, b = a + 1, c = a + W, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = c;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const bind = (name, size, offset) => {
      const loc = gl.getAttribLocation(terrainProg, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, offset);
    };
    bind('aPos', 3, 0); bind('aNormal', 3, 12); bind('aRoadDist', 1, 24);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  })();

  // ---- Road mesh ---------------------------------------------------------
  const road = (() => {
    const cols = [-10.5, -9.0, -7.25, -5.5, -3.75, -2.0, 0, 2.0, 3.75, 5.5, 7.25, 9.0, 10.5];
    const rows = CENTERLINE.count + 1;
    const data = new Float32Array(rows * cols.length * 5);
    let o = 0;
    for (let r = 0; r < rows; r++) {
      const i = r % CENTERLINE.count;
      const s = r === CENTERLINE.count ? TRACK_LENGTH : i * CENTERLINE.step;
      const cx = CENTERLINE.xs[i], cy = CENTERLINE.ys[i], cz = CENTERLINE.zs[i], yaw = CENTERLINE.yaw[i];
      for (const d of cols) {
        data[o++] = cx + Math.sin(yaw) * d;
        data[o++] = cy - Math.cos(yaw) * d;
        data[o++] = cz + 0.02;
        data[o++] = s;
        data[o++] = d;
      }
    }
    const C = cols.length;
    const idx = new Uint32Array((rows - 1) * (C - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < C - 1; c++) {
        const a = r * C + c, b = a + 1, d0 = a + C, d1 = d0 + 1;
        idx[k++] = a; idx[k++] = d0; idx[k++] = b;
        idx[k++] = b; idx[k++] = d0; idx[k++] = d1;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const bind = (name, size, offset) => {
      const loc = gl.getAttribLocation(roadProg, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, offset);
    };
    bind('aPos', 3, 0); bind('aRoad', 2, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  })();

  // ---- Instanced meshes --------------------------------------------------
  function createInstanced(meshData) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mesh = new Float32Array(meshData);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    const bindMesh = (name, size, offset) => {
      const loc = gl.getAttribLocation(instProg, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, offset);
    };
    bindMesh('aPos', 3, 0); bindMesh('aNormal', 3, 12); bindMesh('aVColor', 4, 24);
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    const bindInst = (name, size, offset) => {
      const loc = gl.getAttribLocation(instProg, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, INST_STRIDE * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    bindInst('iPos', 3, 0); bindInst('iSize', 3, 3); bindInst('iYaw', 1, 6);
    bindInst('iColor', 4, 7); bindInst('iEmissive', 1, 11);
    gl.bindVertexArray(null);
    return { vao, ibuf, vertCount: mesh.length / 10, instances: 0 };
  }

  function uploadInstances(target, arr, usage) {
    gl.bindBuffer(gl.ARRAY_BUFFER, target.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, usage);
    target.instances = arr.length / INST_STRIDE;
  }

  const boxes = createInstanced(boxMesh());
  const trees = createInstanced(treeMesh());
  const rocks = createInstanced(rockMesh());
  const sceneryBoxes = createInstanced(boxMesh());
  const sceneryTrees = createInstanced(treeMesh());
  const sceneryRocks = createInstanced(rockMesh());
  const shadows = createInstanced(boxMesh());

  // ---- Static scenery ----------------------------------------------------
  (() => {
    const railBoxes = [];
    const push = (arr, x, y, z, sx, sy, sz, yaw, col, a = 1, em = 0) =>
      arr.push(x, y, z, sx, sy, sz, yaw, col[0], col[1], col[2], a, em);
    const steel = [0.55, 0.58, 0.62], concrete = [0.42, 0.40, 0.36];
    const white = [0.85, 0.86, 0.84], yellow = [0.92, 0.72, 0.15], red = [0.8, 0.18, 0.14];

    for (let s = 0; s < TRACK_LENGTH; s += 2.5) {
      const t = sampleTrack(s + 1.25);
      for (const side of [-1, 1]) {
        const probe = roadToWorld(s + 1.25, side * 17);
        const drop = t.z - terrainHeight(probe.x, probe.y);
        const p = roadToWorld(s + 1.25, side * 10.1);
        if (drop > 1.0) {
          // Fill side: W-beam guardrail with posts, red/white hazard reflectors
          push(railBoxes, p.x, p.y, t.z + 0.5, 2.55, 0.1, 0.32, t.yaw, steel);
          const q = roadToWorld(s, side * 10.1);
          push(railBoxes, q.x, q.y, t.z, 0.14, 0.14, 0.82, t.yaw, [0.35, 0.36, 0.38]);
          if (Math.round(s / 2.5) % 8 === 0) push(railBoxes, q.x, q.y, t.z + 0.82, 0.16, 0.16, 0.14, t.yaw, red, 1, 0.6);
        } else if (drop < -0.8) {
          // Cut side: masonry drain kerb at the toe of the slope
          push(railBoxes, p.x, p.y, t.z - 0.05, 2.55, 0.5, 0.45, t.yaw, concrete);
        }
      }
    }
    // Milestones every 200 m on the left verge (white body, yellow cap)
    for (let s = 50; s < TRACK_LENGTH; s += 200) {
      const p = roadToWorld(s, -9.6), t = sampleTrack(s);
      push(railBoxes, p.x, p.y, t.z, 0.28, 0.5, 0.6, t.yaw, white);
      push(railBoxes, p.x, p.y, t.z + 0.6, 0.28, 0.5, 0.22, t.yaw, yellow);
    }
    uploadInstances(sceneryBoxes, new Float32Array(railBoxes), gl.STATIC_DRAW);

    // Forest & rocks on the slopes (jittered grid, deterministic)
    const treeArr = [], rockArr = [];
    const { x0, y0, width, height, cell, minZ, maxZ } = TERRAIN;
    const x1 = x0 + (width - 1) * cell, y1 = y0 + (height - 1) * cell;
    const span = maxZ - minZ;
    for (let gy = y0; gy < y1; gy += 7) {
      for (let gx = x0; gx < x1; gx += 7) {
        const ix = Math.round(gx / 7), iy = Math.round(gy / 7);
        const x = gx + (hash2(ix, iy) - 0.5) * 6.5;
        const y = gy + (hash2(iy + 91, ix - 17) - 0.5) * 6.5;
        const fx = Math.round((x - x0) / cell), fy = Math.round((y - y0) / cell);
        if (fx < 1 || fy < 1 || fx >= width - 1 || fy >= height - 1) continue;
        const rd = TERRAIN.roadDist[fy * width + fx];
        if (rd < 17) continue;
        const z = terrainHeight(x, y);
        const tRel = (z - minZ) / span;
        const gxs = terrainHeight(x + 3, y) - terrainHeight(x - 3, y);
        const gys = terrainHeight(x, y + 3) - terrainHeight(x, y - 3);
        const slope = Math.hypot(gxs, gys) / 6;
        const density = hash2(Math.floor(x / 40), Math.floor(y / 40) + 7) * 0.6 + 0.25;
        const r = hash2(ix * 3 + 1, iy * 5 + 2);
        if (tRel < 0.5 && slope < 0.9 && r < density * 0.6) {
          const h = 5 + hash2(ix, iy + 5) * 6;
          const g = 0.75 + hash2(ix + 3, iy) * 0.35;
          treeArr.push(x, y, z - 0.2, h * 0.45, h * 0.45, h, 0, 0.13 * g, 0.26 * g, 0.15 * g, 1, 0);
        } else if (tRel > 0.35 && r > 0.9) {
          const sz = 1.2 + hash2(ix + 9, iy) * 3.2;
          const c = 0.30 + hash2(ix, iy + 13) * 0.12;
          rockArr.push(x, y, z - 0.3, sz, sz * 0.9, sz * 0.6, r * 6.28, c, c * 0.95, c * 0.88, 1, 0);
        }
      }
    }
    uploadInstances(sceneryTrees, new Float32Array(treeArr), gl.STATIC_DRAW);
    uploadInstances(sceneryRocks, new Float32Array(rockArr), gl.STATIC_DRAW);
  })();

  // ---- Camera ------------------------------------------------------------
  const camera = {
    mode: 'TOP',
    yaw: 0, targetYaw: null,
    pitch: 89.5, dist: 190, fov: 36, ahead: 26,
    orbitYaw: 0, zoom: 1,
    viewProj: null, eye: [0, 0, 0]
  };
  const PRESETS = {
    'TOP': { pitch: 89.5, dist: 190, fov: 36, ahead: 26 },
    'CHASE': { pitch: 25, dist: 72, fov: 48, ahead: 24 }
  };

  function updateCamera(ego, aspect, dt) {
    const p = PRESETS[camera.mode];
    const k = 1 - Math.exp(-dt * 4);
    camera.pitch += (p.pitch - camera.pitch) * k;
    camera.dist += (p.dist * camera.zoom - camera.dist) * k;
    camera.fov += (p.fov - camera.fov) * k;
    camera.ahead += (p.ahead - camera.ahead) * k;
    // Heading-up follow with critically-damped yaw
    if (camera.targetYaw === null) camera.yaw = ego.yaw;
    let dy = ego.yaw - camera.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    camera.yaw += dy * (1 - Math.exp(-camera.yawDt * 3.5));
    camera.targetYaw = ego.yaw;

    const yaw = camera.yaw + camera.orbitYaw;
    const pitch = camera.pitch * Math.PI / 180;
    const fwdH = [Math.cos(yaw), Math.sin(yaw)];
    const target = [ego.x + fwdH[0] * camera.ahead, ego.y + fwdH[1] * camera.ahead, ego.z];
    const fwd = [Math.cos(pitch) * fwdH[0], Math.cos(pitch) * fwdH[1], -Math.sin(pitch)];
    const eye = [target[0] - fwd[0] * camera.dist, target[1] - fwd[1] * camera.dist, target[2] - fwd[2] * camera.dist];
    const right = [Math.sin(yaw), -Math.cos(yaw), 0];
    const view = viewFromBasis(eye, fwd, right);
    const proj = perspective(camera.fov * Math.PI / 180, aspect, 1.0, 2500);
    camera.viewProj = multiply(proj, view);
    camera.eye = eye;
    camera.right = right;
    camera.fwdH = fwdH;
  }

  // ---- Per-frame object instances ---------------------------------------
  function buildObjectInstances(frame, selectedId) {
    const box = [], tree = [], rock = [], shadow = [];
    const push = (arr, x, y, z, sx, sy, sz, yaw, col, a = 1, em = 0) =>
      arr.push(x, y, z, sx, sy, sz, yaw, col[0], col[1], col[2], a, em);
    // Parts are given in the object's local frame (fx forward, fy left, fz up)
    const part = (w, yaw, fx, fy, fz, sx, sy, sz, col, em = 0) => {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      push(box, w.x + c * fx - s * fy, w.y + s * fx + c * fy, w.z + fz, sx, sy, sz, yaw, col, 1, em);
    };
    const shade = (w, yaw, sx, sy) => {
      // Blob shadow cast away from the NW sun
      push(shadow, w.x + 0.35, w.y - 0.35, w.z + 0.035, sx, sy, 0.01, yaw, [0, 0, 0], 0.38);
    };

    for (const obj of frame.objects) {
      const w = obj.world;
      if (!w) continue;
      const sel = String(obj.track_id) === String(selectedId);
      const hl = sel ? 0.35 : 0;
      const b = obj.bbox || { l: 1, w: 1, h: 1 };
      const yaw = w.yaw;
      switch (obj.class) {
        case 'dynamic_vehicle': {
          const paint = hexToRgb(VEHICLE_PAINT[obj.color] || VEHICLE_PAINT.slate);
          const glass = [0.07, 0.10, 0.14], tyre = [0.05, 0.05, 0.06];
          shade(w, yaw, b.l * 1.05, b.w * 1.1);
          if (obj.kind === 'truck') {
            part(w, yaw, b.l / 2 - 1.1, 0, 0.55, 2.2, b.w, 2.1, paint, hl);           // cab
            part(w, yaw, b.l / 2 - 0.35, 0, 1.55, 0.3, b.w * 0.9, 0.8, glass);         // windscreen
            part(w, yaw, -0.9, 0, 0.75, b.l - 2.6, b.w, b.h - 0.75, [0.55, 0.52, 0.44], hl); // cargo body
            for (const fx of [b.l / 2 - 1.3, -b.l / 2 + 1.6, -b.l / 2 + 2.9]) {
              for (const fy of [-b.w / 2, b.w / 2]) part(w, yaw, fx, fy, 0, 1.0, 0.35, 0.95, tyre);
            }
          } else {
            part(w, yaw, 0, 0, 0.3, b.l, b.w, 0.72, paint, hl);                          // body
            part(w, yaw, -0.25, 0, 1.0, b.l * 0.5, b.w * 0.86, b.h - 1.0, glass);       // cabin glass
            part(w, yaw, -0.25, 0, b.h - 0.04, b.l * 0.44, b.w * 0.8, 0.05, paint, hl); // roof
            part(w, yaw, b.l / 2 - 0.02, 0.62, 0.62, 0.04, 0.35, 0.12, [1, 0.95, 0.8], 1.2); // headlights
            part(w, yaw, b.l / 2 - 0.02, -0.62, 0.62, 0.04, 0.35, 0.12, [1, 0.95, 0.8], 1.2);
            part(w, yaw, -b.l / 2 + 0.02, 0.65, 0.65, 0.04, 0.3, 0.1, [0.9, 0.1, 0.08], 1.0); // tail lights
            part(w, yaw, -b.l / 2 + 0.02, -0.65, 0.65, 0.04, 0.3, 0.1, [0.9, 0.1, 0.08], 1.0);
            for (const fx of [b.l * 0.32, -b.l * 0.32]) {
              for (const fy of [-b.w / 2, b.w / 2]) part(w, yaw, fx, fy, 0, 0.7, 0.26, 0.62, tyre);
            }
          }
          break;
        }
        case 'dynamic_human':
        case 'dynamic_pedestrian': {
          shade(w, yaw, 0.7, 0.7);
          part(w, yaw, 0, 0.1, 0, 0.22, 0.16, 0.85, [0.16, 0.18, 0.24]);             // legs
          part(w, yaw, 0, -0.1, 0, 0.22, 0.16, 0.85, [0.16, 0.18, 0.24]);
          part(w, yaw, 0, 0, 0.85, 0.3, 0.46, 0.6, [0.96, 0.45, 0.09], 0.25 + hl);  // hi-vis vest
          part(w, yaw, 0, 0, 1.47, 0.22, 0.22, 0.26, [0.72, 0.52, 0.40]);            // head
          part(w, yaw, 0, 0, 1.7, 0.26, 0.26, 0.08, [0.95, 0.85, 0.2]);              // helmet
          break;
        }
        case 'static_pole':
        case 'static_obstacle_pole': {
          // Street light: mast + outreach arm toward the carriageway + luminaire
          // Local +y is left of the road direction; the arm reaches toward the centreline
          const arm = (obj.road?.d ?? 0) < 0 ? -1 : 1;
          shade(w, yaw, 0.6, 0.6);
          part(w, yaw, 0, 0, 0, 0.26, 0.26, b.h, [0.50, 0.53, 0.57], hl);
          part(w, yaw, 0, arm * 1.2, b.h - 0.2, 0.14, 2.4, 0.14, [0.50, 0.53, 0.57], hl);
          part(w, yaw, 0, arm * 2.3, b.h - 0.35, 0.4, 0.7, 0.18, [1.0, 0.92, 0.7], 1.4);
          break;
        }
        case 'static_wall':
        case 'static_obstacle_wall': {
          shade(w, yaw, b.l, 1.0);
          part(w, yaw, 0, 0, -0.2, b.l, b.w, b.h + 0.2, [0.44, 0.41, 0.36], hl);
          part(w, yaw, 0, 0, b.h, b.l, b.w + 0.1, 0.15, [0.55, 0.52, 0.47], hl);
          for (let fx = -b.l / 2 + 2; fx < b.l / 2; fx += 4) {
            part(w, yaw, fx, 0, 0.3, 0.12, b.w + 0.04, b.h - 0.6, [0.33, 0.31, 0.28]);
          }
          break;
        }
        case 'static_tree':
        case 'static_obstacle_tree':
        case 'tree':
          shade(w, yaw, b.l * 0.8, b.w * 0.8);
          push(tree, w.x, w.y, w.z - 0.2, b.l * 0.9, b.w * 0.9, b.h, 0, [0.12, 0.30, 0.15], 1, hl);
          break;
        case 'curb':
          part(w, yaw, 0, 0, 0, b.l, b.w + 0.1, 0.25, [0.9, 0.78, 0.2], 0.2 + hl);
          part(w, yaw, -0.5, 0, 0, 0.5, b.w + 0.12, 0.26, [0.1, 0.1, 0.1]);
          part(w, yaw, 0.5, 0, 0, 0.5, b.w + 0.12, 0.26, [0.1, 0.1, 0.1]);
          break;
        case 'unclassified':
          shade(w, yaw, b.l, b.w);
          push(rock, w.x, w.y, w.z - 0.15, b.l, b.w, b.h, 1.1, [0.42, 0.39, 0.35], 1, hl);
          break;
        default:
          break; // potholes are painted into the road shader
      }
    }

    // Ego UGV (6x6 patrol vehicle, olive drab, roof LiDAR)
    const e = frame.ego;
    const ew = { x: e.x, y: e.y, z: e.z };
    const olive = [0.33, 0.38, 0.20], oliveDark = [0.24, 0.28, 0.15];
    shade(ew, e.yaw, 5.6, 2.8);
    part(ew, e.yaw, 0, 0, 0.45, 5.2, 2.35, 0.95, olive);
    part(ew, e.yaw, 0.55, 0, 1.4, 1.2, 2.1, 0.7, [0.06, 0.09, 0.12]);              // armoured glazing
    part(ew, e.yaw, -0.6, 0, 1.4, 2.6, 2.2, 0.75, oliveDark);                      // upper hull
    part(ew, e.yaw, 2.62, 0, 0.55, 0.08, 1.9, 0.3, [0.2, 0.22, 0.12]);             // bumper
    part(ew, e.yaw, 2.6, 0.8, 0.9, 0.05, 0.35, 0.14, [0.85, 0.95, 1.0], 1.5);       // headlights
    part(ew, e.yaw, 2.6, -0.8, 0.9, 0.05, 0.35, 0.14, [0.85, 0.95, 1.0], 1.5);
    part(ew, e.yaw, 0.2, 0, 2.15, 0.18, 0.18, 0.35, [0.2, 0.2, 0.22]);             // sensor mast
    part(ew, e.yaw, 0.2, 0, 2.5, 0.62, 0.62, 0.38, [0.0, 0.85, 0.95], 0.9);        // LiDAR puck
    for (const fx of [1.75, 0, -1.75]) {
      for (const fy of [-1.2, 1.2]) part(ew, e.yaw, fx, fy, 0, 1.05, 0.42, 1.05, [0.05, 0.05, 0.06]);
    }

    uploadInstances(boxes, new Float32Array(box), gl.DYNAMIC_DRAW);
    uploadInstances(trees, new Float32Array(tree), gl.DYNAMIC_DRAW);
    uploadInstances(rocks, new Float32Array(rock), gl.DYNAMIC_DRAW);
    uploadInstances(shadows, new Float32Array(shadow), gl.DYNAMIC_DRAW);
  }

  // ---- Draw --------------------------------------------------------------
  const settings = { showPoints: true, showGrid: true, contourMinor: 5, contourMajor: 25 };
  let lastTime = performance.now();

  function setCommonUniforms(prog, ego, sweep) {
    gl.uniformMatrix4fv(prog.u('uViewProj'), false, camera.viewProj);
    gl.uniform3f(prog.u('uEgo'), ego.x, ego.y, ego.z);
    const z = Math.max(1, camera.zoom);
    gl.uniform2f(prog.u('uFog'), 240 * z, 430 * z);
    gl.uniform3f(prog.u('uBg'), BG[0], BG[1], BG[2]);
    gl.uniform1f(prog.u('uSweep'), sweep);
    gl.uniform4f(prog.u('uBands'), BANDS[0], BANDS[1], BANDS[2], BANDS[3]);
    gl.uniform3f(prog.u('uLight'), LIGHT[0], LIGHT[1], LIGHT[2]);
  }

  function drawInstanced(target, vertCount) {
    if (!target.instances) return;
    gl.bindVertexArray(target.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertCount ?? target.vertCount, target.instances);
  }

  function render(frame, selectedId) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    camera.yawDt = Math.min(0.5, (now - lastTime) / 1000);
    lastTime = now;
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    updateCamera(frame.ego, w / h, dt);
    buildObjectInstances(frame, selectedId);

    const sweep = (now / 1000) * (Math.PI * 2 / 2.4);
    const ego = frame.ego;

    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // Terrain
    gl.useProgram(terrainProg);
    setCommonUniforms(terrainProg, ego, sweep);
    gl.uniform2f(terrainProg.u('uZRange'), TERRAIN.minZ, TERRAIN.maxZ);
    gl.uniform1f(terrainProg.u('uContourMinor'), settings.contourMinor);
    gl.uniform1f(terrainProg.u('uContourMajor'), settings.contourMajor);
    gl.uniform1f(terrainProg.u('uShowPoints'), settings.showPoints ? 1 : 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(terrain.vao);
    gl.drawElements(gl.TRIANGLES, terrain.count, gl.UNSIGNED_INT, 0);

    // Road deck
    gl.useProgram(roadProg);
    setCommonUniforms(roadProg, ego, sweep);
    gl.uniform1f(roadProg.u('uShowGrid'), settings.showGrid ? 1 : 0);
    gl.uniform1f(roadProg.u('uCarriageHalf'), ROAD.carriageHalf);
    gl.uniform1f(roadProg.u('uShoulderHalf'), ROAD.shoulderHalf);
    const haz = frame.objects.filter(o => o.class === 'pothole').slice(0, 4);
    const hazArr = new Float32Array(16);
    haz.forEach((o, i) => {
      hazArr[i * 4] = o.road?.s ?? 0;
      hazArr[i * 4 + 1] = o.road?.d ?? 0;
      hazArr[i * 4 + 2] = o.radius || 1.2;
    });
    gl.uniform4fv(roadProg.u('uHaz'), hazArr);
    gl.uniform1i(roadProg.u('uHazCount'), haz.length);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -2);
    gl.bindVertexArray(road.vao);
    gl.drawElements(gl.TRIANGLES, road.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Scenery + objects
    gl.enable(gl.CULL_FACE);
    gl.useProgram(instProg);
    setCommonUniforms(instProg, ego, sweep);
    gl.uniform1f(instProg.u('uUnlit'), 0);
    drawInstanced(sceneryBoxes);
    drawInstanced(sceneryTrees);
    drawInstanced(sceneryRocks);
    drawInstanced(boxes);
    drawInstanced(trees);
    drawInstanced(rocks);

    // Blob shadows (blended, no depth writes)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-4, -4);
    gl.uniform1f(instProg.u('uUnlit'), 1);
    drawInstanced(shadows);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    return camera;
  }

  return {
    render,
    camera,
    settings,
    setMode(mode) { if (PRESETS[mode]) { camera.mode = mode; camera.orbitYaw = 0; } },
    zoomBy(f) { camera.zoom = Math.min(2.6, Math.max(0.35, camera.zoom * f)); },
    orbit(dYaw) { camera.orbitYaw += dYaw; },
    resetView() { camera.zoom = 1; camera.orbitYaw = 0; }
  };
}
