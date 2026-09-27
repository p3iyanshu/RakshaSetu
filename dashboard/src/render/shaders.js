/**
 * GLSL ES 3.0 shaders for the 2.5D perception scene.
 *
 * Shared fragment conventions:
 *   uEgo      ego world position (fog, range rings and LiDAR sweep are ego-centred)
 *   uFog      (start, end) horizontal fog distances from the ego
 *   uBg       background colour the scene fades into
 */

const COMMON = /* glsl */ `
uniform vec3 uEgo;
uniform vec2 uFog;
uniform vec3 uBg;
uniform float uSweep;
uniform vec4 uBands;       // foveated range bands (m): 10, 30, 60, 120

float aaLine(float coord, float widthPx) {
  // Distance-to-integer line, antialiased in screen space
  float d = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), 1e-4);
  return 1.0 - smoothstep(widthPx * 0.5, widthPx * 0.5 + 1.0, d);
}

float ring(float r, float radius, float widthPx) {
  float d = abs(r - radius) / max(fwidth(r), 1e-4);
  return 1.0 - smoothstep(widthPx * 0.5, widthPx * 0.5 + 1.0, d);
}

vec3 applyFog(vec3 c, vec3 world) {
  float r = length(world.xy - uEgo.xy);
  return mix(c, uBg, smoothstep(uFog.x, uFog.y, r));
}

float sweepGlow(vec3 world) {
  vec2 v = world.xy - uEgo.xy;
  float a = atan(v.y, v.x);
  float lag = mod(uSweep - a, 6.2831853);
  return exp(-lag * 3.2);
}

vec3 elevRamp(float t) {
  // Matches the dashboard elevation legend: cyan -> green -> yellow -> orange -> purple
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.00, 0.95, 1.00);
  vec3 c1 = vec3(0.00, 0.90, 0.46);
  vec3 c2 = vec3(0.98, 0.80, 0.08);
  vec3 c3 = vec3(0.98, 0.45, 0.09);
  vec3 c4 = vec3(0.75, 0.52, 0.99);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}
`;

// ---------------------------------------------------------------------------
// Terrain: hypsometric tint + hillshade + concentric contour lines
// ---------------------------------------------------------------------------
export const TERRAIN_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in float aRoadDist;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out float vRoadDist;
void main() {
  vWorld = aPos;
  vNormal = aNormal;
  vRoadDist = aRoadDist;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in float vRoadDist;
uniform vec2 uZRange;       // min/max terrain z
uniform vec3 uLight;
uniform float uContourMinor;
uniform float uContourMajor;
uniform float uShowPoints;
out vec4 outColor;

vec3 hypso(float t) {
  // Muted high-altitude palette: valley scrub -> conifer -> alpine meadow -> scree -> rock -> snow
  vec3 a = vec3(0.075, 0.110, 0.090);
  vec3 b = vec3(0.090, 0.150, 0.105);
  vec3 c = vec3(0.170, 0.185, 0.120);
  vec3 d = vec3(0.235, 0.205, 0.160);
  vec3 e = vec3(0.300, 0.300, 0.300);
  vec3 f = vec3(0.620, 0.660, 0.700);
  if (t < 0.15) return mix(a, b, t / 0.15);
  if (t < 0.38) return mix(b, c, (t - 0.15) / 0.23);
  if (t < 0.60) return mix(c, d, (t - 0.38) / 0.22);
  if (t < 0.82) return mix(d, e, (t - 0.60) / 0.22);
  return mix(e, f, (t - 0.82) / 0.18);
}

void main() {
  vec3 n = normalize(vNormal);
  float t = (vWorld.z - uZRange.x) / (uZRange.y - uZRange.x);
  vec3 base = hypso(t);

  // Cartographic hillshade (NW light) + slope darkening
  float diff = max(dot(n, normalize(uLight)), 0.0);
  float slope = 1.0 - n.z;
  vec3 col = base * (0.30 + 1.25 * diff) * (1.0 - slope * 0.2);

  // Road formation reads as compacted earth right beside the carriageway
  col = mix(vec3(0.16, 0.15, 0.13), col, smoothstep(10.5, 16.0, vRoadDist));

  // Concentric contour rings (minor every uContourMinor m, index every uContourMajor m)
  float minor = aaLine(vWorld.z / uContourMinor, 1.0);
  float major = aaLine(vWorld.z / uContourMajor, 1.8);
  float onSlope = smoothstep(13.0, 22.0, vRoadDist);
  col = mix(col, vec3(0.62, 0.78, 0.74), minor * 0.30 * onSlope);
  col = mix(col, vec3(0.45, 0.92, 0.95), major * 0.62 * onSlope);

  // Foveated LiDAR range rings (10 / 30 / 60 / 120 m) centred on the ego
  float r = length(vWorld.xy - uEgo.xy);
  float rings = max(max(ring(r, uBands.x, 1.4), ring(r, uBands.y, 1.4)),
                    max(ring(r, uBands.z, 1.4), ring(r, uBands.w, 1.6)));
  col = mix(col, vec3(0.0, 0.95, 1.0), rings * 0.55);

  // LiDAR point returns: dot lattice whose pitch grows with range (foveation)
  if (uShowPoints > 0.5 && r < uBands.w) {
    float cell = r < uBands.x ? 0.6 : (r < uBands.y ? 1.2 : (r < uBands.z ? 2.2 : 3.6));
    vec2 g = (fract(vWorld.xy / cell) - 0.5) * cell;
    float px = fwidth(vWorld.x) + fwidth(vWorld.y);
    float dotMask = 1.0 - smoothstep(0.06 * cell, 0.06 * cell + px, length(g));
    float rel = clamp((vWorld.z - uEgo.z + 1.0) / 30.0, 0.0, 1.0);
    vec3 pc = elevRamp(rel);
    float glow = sweepGlow(vWorld);
    float fade = 1.0 - smoothstep(uBands.y, uBands.w, r);
    col = mix(col, pc, dotMask * (0.16 + 0.6 * glow) * fade);
  }

  // Sweep wash
  col += vec3(0.0, 0.35, 0.30) * sweepGlow(vWorld) * 0.10 * (1.0 - smoothstep(0.0, uBands.w, r));

  outColor = vec4(applyFog(col, vWorld), 1.0);
}`;

// ---------------------------------------------------------------------------
// Road: asphalt, IRC lane markings, drivable foveated grid, hazard decals
// ---------------------------------------------------------------------------
export const ROAD_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec2 aRoad;     // (s, d)
uniform mat4 uViewProj;
out vec3 vWorld;
out vec2 vRoad;
void main() {
  vWorld = aPos;
  vRoad = aRoad;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const ROAD_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld;
in vec2 vRoad;
uniform vec4 uHaz[4];      // (s, d, radius, 0)
uniform int uHazCount;
uniform float uShowGrid;
uniform float uCarriageHalf;
uniform float uShoulderHalf;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float band(float x, float center, float halfW) {
  float aa = fwidth(x) * 0.8;
  return 1.0 - smoothstep(halfW - aa, halfW + aa, abs(x - center));
}

void main() {
  float s = vRoad.x;
  float d = vRoad.y;
  float ad = abs(d);

  // Surfaces
  float grain = hash(floor(vWorld.xy * 4.0)) * 0.025;
  vec3 asphalt = vec3(0.105, 0.115, 0.130) + grain;
  vec3 shoulder = vec3(0.170, 0.165, 0.155) + grain;
  vec3 verge = vec3(0.200, 0.185, 0.160) + grain;
  vec3 col = ad < uCarriageHalf ? asphalt : (ad < uShoulderHalf ? shoulder : verge);
  // Wheel-path polish in each lane
  float lanePos = mod(ad - 0.25, 3.5);
  col += vec3(0.018) * (band(lanePos, 0.95, 0.35) + band(lanePos, 2.55, 0.35)) * step(ad, uCarriageHalf);

  // Markings
  vec3 white = vec3(0.86, 0.88, 0.90);
  vec3 yellow = vec3(0.95, 0.74, 0.12);
  float edge = band(ad, uCarriageHalf - 0.12, 0.08);
  float dash = step(fract(s / 9.0), 0.333);
  float laneLine = band(ad, 3.75, 0.07) * dash;
  float median = band(ad, 0.14, 0.06);
  col = mix(col, white, max(edge, laneLine) * 0.9);
  col = mix(col, yellow, median * 0.95);

  // Distance from ego
  float r = length(vWorld.xy - uEgo.xy);

  // Hazard decals (potholes): dark crater + rim
  float hazard = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uHazCount) break;
    vec2 q = vec2((s - uHaz[i].x) / 1.45, d - uHaz[i].y);
    float rr = length(q) / uHaz[i].z;
    float crater = 1.0 - smoothstep(0.75, 1.0, rr);
    col = mix(col, vec3(0.035, 0.030, 0.035), crater * 0.9);
    col = mix(col, vec3(0.30, 0.27, 0.24), (smoothstep(0.8, 1.0, rr) - smoothstep(1.0, 1.25, rr)) * 0.6);
    hazard = max(hazard, 1.0 - smoothstep(1.2, 1.9, rr));
  }

  // Drivable-area perception overlay with foveated cell grid
  if (uShowGrid > 0.5 && ad < uCarriageHalf && r < uBands.w) {
    float cell = r < uBands.x ? 0.5 : (r < uBands.y ? 1.0 : (r < uBands.z ? 2.0 : 3.5));
    vec2 gc = vec2(s, d) / cell;
    float grid = max(aaLine(gc.x, 1.0), aaLine(gc.y, 1.0));
    float fade = 1.0 - smoothstep(uBands.y, uBands.w, r);
    float bandBoost = r < uBands.x ? 1.0 : (r < uBands.y ? 0.75 : 0.5);
    vec3 green = vec3(0.0, 0.90, 0.46);
    vec3 purple = vec3(0.75, 0.52, 0.99);
    vec3 tint = mix(green, purple, hazard);
    col = mix(col, tint, (0.05 + 0.07 * bandBoost) * fade);
    col = mix(col, tint, grid * 0.30 * bandBoost * fade);
    col += tint * sweepGlow(vWorld) * 0.08 * fade;
  }

  // Range rings continue across the deck
  float rings = max(max(ring(r, uBands.x, 1.4), ring(r, uBands.y, 1.4)),
                    max(ring(r, uBands.z, 1.4), ring(r, uBands.w, 1.6)));
  col = mix(col, vec3(0.0, 0.95, 1.0), rings * 0.6);

  outColor = vec4(applyFog(col, vWorld), 1.0);
}`;

// ---------------------------------------------------------------------------
// Instanced meshes: vehicles, people, poles, trees, rocks, guardrails
// ---------------------------------------------------------------------------
export const INST_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec4 aVColor;           // rgb + mix (1 = use vertex colour instead of instance)
in vec3 iPos;
in vec3 iSize;
in float iYaw;
in vec4 iColor;
in float iEmissive;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
out float vEm;
void main() {
  float c = cos(iYaw), s = sin(iYaw);
  vec3 p = aPos * iSize;
  vec3 w = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + iPos;
  vec3 nl = normalize(aNormal / max(iSize, vec3(1e-3)));
  vNormal = vec3(c * nl.x - s * nl.y, s * nl.x + c * nl.y, nl.z);
  vColor = vec4(mix(iColor.rgb, aVColor.rgb, aVColor.a), iColor.a);
  vEm = iEmissive;
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const INST_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
in float vEm;
uniform vec3 uLight;
uniform float uUnlit;
out vec4 outColor;
void main() {
  if (uUnlit > 0.5) {
    outColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(uFog.x, uFog.y, length(vWorld.xy - uEgo.xy))));
    return;
  }
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLight)), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  vec3 col = vColor.rgb * (0.30 + 0.25 * sky + 0.85 * diff);
  col += vColor.rgb * vEm;
  outColor = vec4(applyFog(col, vWorld), vColor.a);
}`;
