import * as THREE from "three";

const COLORMAP_GLSL = /* glsl */ `
vec3 turbo(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(
    0.13572138 + t*(4.61539260 + t*(-42.66032258 + t*(132.13108234 + t*(-152.94239396 + t*59.28637943)))),
    0.09140161 + t*(2.19418839 + t*(4.84296658 + t*(-14.18503333 + t*(4.27729857 + t*2.82956604)))),
    0.10667330 + t*(12.64194608 + t*(-60.58204836 + t*(110.36276771 + t*(-89.90310912 + t*27.34824973))))
  ), 0.0, 1.0);
}
vec3 viridis(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(
    0.2803 + t*(-1.4625 + t*(7.3286 + t*(-11.5712 + t*6.2114))),
    0.1449 + t*(2.2959 + t*(-4.7887 + t*(5.8801 + t*-2.2037))),
    0.4566 + t*(2.0761 + t*(-9.9819 + t*(16.2606 + t*-8.2569)))
  ), 0.0, 1.0);
}
// Cyber-Neon: electric blue -> magenta -> hot orange
vec3 neon(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.05, 0.30, 1.00);
  vec3 b = vec3(0.90, 0.10, 0.95);
  vec3 c = vec3(1.00, 0.45, 0.10);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}
// Infrared: black -> crimson -> amber -> white (ToF echo strength)
vec3 infrared(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.0, 0.05);
  vec3 b = vec3(0.75, 0.05, 0.10);
  vec3 c = vec3(1.0, 0.65, 0.10);
  vec3 d = vec3(1.0, 1.0, 0.92);
  return t < 0.4 ? mix(a, b, t / 0.4) : (t < 0.75 ? mix(b, c, (t - 0.4) / 0.35) : mix(c, d, (t - 0.75) / 0.25));
}
// Height / Z-slice: deep blue -> cyan -> lime -> gold
vec3 heightMap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.05, 0.15, 0.45);
  vec3 b = vec3(0.00, 0.85, 0.95);
  vec3 c = vec3(0.45, 1.00, 0.20);
  vec3 d = vec3(1.00, 0.85, 0.15);
  return t < 0.34 ? mix(a, b, t / 0.34) : (t < 0.67 ? mix(b, c, (t - 0.34) / 0.33) : mix(c, d, (t - 0.67) / 0.33));
}
`;

export const vertexShader = /* glsl */ `
attribute float intensity;
varying float vIntensity;
varying float vRange;
varying float vHeight;
varying vec3 vWorldPos;
uniform float pointSize;
uniform float uTime;
void main() {
  vIntensity = intensity;
  vRange = length(position.xy);
  vHeight = position.z;
  vWorldPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  // natural perspective falloff 1/d, clamped to sane sprite sizes
  gl_PointSize = clamp(pointSize * (160.0 / max(dist, 0.5)), 1.0, 48.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
varying float vIntensity;
varying float vRange;
varying float vHeight;
varying vec3 vWorldPos;
uniform int colormapMode;   // 0 neon, 1 turbo, 2 viridis, 3 infrared, 4 height, 5 velocity
uniform float maxRange;
uniform float intensityMin;
uniform vec3 roiMin;
uniform vec3 roiMax;
uniform float uTime;
${COLORMAP_GLSL}
void main() {
  if (vIntensity < intensityMin) discard;
  if (vWorldPos.x < roiMin.x || vWorldPos.x > roiMax.x) discard;
  if (vWorldPos.y < roiMin.y || vWorldPos.y > roiMax.y) discard;
  if (vWorldPos.z < roiMin.z || vWorldPos.z > roiMax.z) discard;

  float tRange = clamp(vRange / maxRange, 0.0, 1.0);
  float tHeight = clamp((vHeight + 2.0) / 10.0, 0.0, 1.0);
  vec3 c;
  if (colormapMode == 0) c = neon(tRange);
  else if (colormapMode == 1) c = turbo(tRange);
  else if (colormapMode == 2) c = viridis(tRange);
  else if (colormapMode == 3) c = infrared(vIntensity);
  else if (colormapMode == 4) c = heightMap(tHeight);
  else {
    // velocity flow: range base with travelling shimmer bands
    c = turbo(tRange) * (0.75 + 0.35 * sin(uTime * 6.0 - vRange * 0.8));
  }

  // anti-aliased soft gaussian disc sprite
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float alpha = exp(-3.5 * r2);
  gl_FragColor = vec4(c * (1.0 + 0.25 * (1.0 - tRange)), 0.9 * alpha);
}
`;

export const COLORMAP_INDEX: Record<string, number> = {
  neon: 0, turbo: 1, viridis: 2, infrared: 3, height: 4, velocity: 5,
};

export function makeColormapUniforms() {
  return {
    pointSize: { value: 2.4 },
    colormapMode: { value: 0 },
    maxRange: { value: 80.0 },
    intensityMin: { value: 0.0 },
    roiMin: { value: new THREE.Vector3(-80, -40, -3) },
    roiMax: { value: new THREE.Vector3(80, 40, 40) },
    uTime: { value: 0 },
  } as Record<string, THREE.IUniform>;
}
