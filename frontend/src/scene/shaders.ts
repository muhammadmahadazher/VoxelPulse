import * as THREE from "three";

// Turbo colormap polynomial approximation (Google AI blog) as GLSL helper
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
vec3 cyber(float t) {
  return vec3(0.0, 0.35 + 0.65*t, 0.25 + 0.6*t*t);
}
`;

export const vertexShader = /* glsl */ `
attribute float intensity;
varying float vIntensity;
varying float vRange;
uniform float pointSize;
void main() {
  vIntensity = intensity;
  vRange = length(position.xy);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSize * (140.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
varying float vIntensity;
varying float vRange;
uniform int colormapMode;   // 0 turbo, 1 viridis, 2 cyber
uniform float maxRange;
uniform float intensityMin;
uniform bool useIntensity;  // color by intensity vs. elevation/range
uniform bool groundDim;
uniform float groundZ;
${COLORMAP_GLSL}
void main() {
  if (vIntensity < intensityMin) discard;
  float t = useIntensity ? vIntensity : clamp(vRange / maxRange, 0.0, 1.0);
  vec3 c = colormapMode == 0 ? turbo(t) : (colormapMode == 1 ? viridis(t) : cyber(t));
  if (groundDim && abs(vRange) < 0.0001) c *= 0.5;
  gl_FragColor = vec4(c, 0.95);
}
`;

export function makeColormapUniforms() {
  return {
    pointSize: { value: 2.0 },
    colormapMode: { value: 0 },
    maxRange: { value: 80.0 },
    intensityMin: { value: 0.0 },
    useIntensity: { value: false },
    groundDim: { value: false },
    groundZ: { value: 0.0 },
  } as Record<string, THREE.IUniform>;
}
