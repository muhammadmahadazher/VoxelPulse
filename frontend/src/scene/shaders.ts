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
// Magma (calibrated reflectivity gradient)
vec3 magma(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.001, 0.000, 0.014);
  vec3 b = vec3(0.42, 0.10, 0.48);
  vec3 c = vec3(0.95, 0.40, 0.35);
  vec3 d = vec3(0.99, 0.99, 0.75);
  return t < 0.4 ? mix(a, b, t / 0.4) : (t < 0.75 ? mix(b, c, (t - 0.4) / 0.35) : mix(c, d, (t - 0.75) / 0.25));
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
// Height / Z-slice: perceptual viridis ramp, normalized to dataset bounds
vec3 heightMap(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(
    0.2803 + t*(-1.4625 + t*(7.3286 + t*(-11.5712 + t*6.2114))),
    0.1449 + t*(2.2959 + t*(-4.7887 + t*(5.8801 + t*-2.2037))),
    0.4566 + t*(2.0761 + t*(-9.9819 + t*(16.2606 + t*-8.2569)))
  ), 0.0, 1.0);
}
// Semantic classification (approximated from geometry):
//   ground (z<0.2) = slate green, objects (0.2..2.6) = class ramp, structures = sand
vec3 classification(float h, float intensity_) {
  if (h < 0.2) return vec3(0.35, 0.52, 0.42);
  if (h < 2.6) return mix(vec3(0.98, 0.72, 0.09), vec3(0.94, 0.98, 0.10), clamp(intensity_, 0.0, 1.0));
  return vec3(0.78, 0.55, 0.35);
}
// Radial proximity zones: 0-10m hot amber, 10-30m cyan, 30-80m violet-blue
vec3 zones(float r) {
  if (r < 10.0) return vec3(1.00, 0.62, 0.04);
  if (r < 30.0) return vec3(0.05, 0.74, 0.98);
  return vec3(0.42, 0.28, 0.85);
}
`;

export const vertexShader = /* glsl */ `
attribute float intensity;
varying float vIntensity;
varying float vRange;
varying float vHeight;
varying vec3 vWorldPos;
uniform float pointSize;
void main() {
  vIntensity = intensity;
  vRange = length(position.xy);
  vHeight = position.z;
  vWorldPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  // natural perspective falloff 1/d, clamped to crisp sample sizes
  gl_PointSize = clamp(pointSize * (26.0 / max(dist, 0.5)), 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
varying float vIntensity;
varying float vRange;
varying float vHeight;
varying vec3 vWorldPos;
uniform int colormapMode;   // 0 neon, 1 turbo, 2 viridis, 3 magma, 4 infrared, 5 height, 6 class, 7 zones
uniform float maxRange;
uniform float intensityMin;
uniform vec3 roiMin;
uniform vec3 roiMax;
uniform float heightMin;
uniform float heightMax;
${COLORMAP_GLSL}
void main() {
  if (vIntensity < intensityMin) discard;
  if (vWorldPos.x < roiMin.x || vWorldPos.x > roiMax.x) discard;
  if (vWorldPos.y < roiMin.y || vWorldPos.y > roiMax.y) discard;
  if (vWorldPos.z < roiMin.z || vWorldPos.z > roiMax.z) discard;

  float tRange = clamp(vRange / maxRange, 0.0, 1.0);
  float hSpan = max(heightMax - heightMin, 0.5);
  float tHeight = clamp((vHeight - heightMin) / hSpan, 0.0, 1.0);
  vec3 c;
  if (colormapMode == 0) c = neon(tRange);
  else if (colormapMode == 1) c = turbo(tRange);
  else if (colormapMode == 2) c = viridis(tRange);
  else if (colormapMode == 3) c = magma(vIntensity);
  else if (colormapMode == 4) c = infrared(vIntensity);
  else if (colormapMode == 5) c = heightMap(tHeight);
  else if (colormapMode == 6) c = classification(vHeight, vIntensity);
  else c = zones(vRange);

  // crisp anti-aliased sample disc — spatial sample, not a glowing orb
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float alpha = smoothstep(1.0, 0.45, r2);
  gl_FragColor = vec4(c, 0.96 * alpha);
}
`;

export const COLORMAP_INDEX: Record<string, number> = {
  neon: 0, turbo: 1, viridis: 2, magma: 3, infrared: 4, height: 5, class: 6, zones: 7,
};

export function makeColormapUniforms() {
  return {
    pointSize: { value: 2.4 },
    colormapMode: { value: 0 },
    maxRange: { value: 80.0 },
    intensityMin: { value: 0.0 },
    roiMin: { value: new THREE.Vector3(-80, -40, -3) },
    roiMax: { value: new THREE.Vector3(80, 40, 40) },
    heightMin: { value: 0.0 },
    heightMax: { value: 10.0 },
  } as Record<string, THREE.IUniform>;
}
