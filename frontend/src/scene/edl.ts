/**
 * Eye-Dome Lighting (EDL) — image-space, non-photorealistic shading technique
 * for dense point clouds (Bauszat et al. / popularized by Potree & ParaView).
 *
 * Each pixel's log-depth is compared against 4 neighbours at a screen-space
 * radius; response `exp(-Σ max(0, log(d) - log(d_neighbour)) · strength)`
 * darkens depth discontinuities, giving clouds tactile relief and readable
 * silhouettes without any scene lights.
 *
 * Implemented as a `postprocessing` Effect with EffectAttribute.DEPTH so the
 * composer automatically provides the scene depth texture.
 */
import { Effect, BlendFunction, EffectAttribute } from "postprocessing";
import { wrapEffect } from "@react-three/postprocessing";
import * as THREE from "three";

const fragmentShader = /* glsl */ `
uniform float strength;
uniform float radius;

float edlDepth(const in vec2 uv) {
  return texture2D(depthBuffer, uv).x;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float logOC = log(max(edlDepth(uv), 1e-6));
  float sum = 0.0;
  sum += max(0.0, logOC - log(max(edlDepth(uv + vec2( radius, 0.0) * texelSize), 1e-6)));
  sum += max(0.0, logOC - log(max(edlDepth(uv + vec2(-radius, 0.0) * texelSize), 1e-6)));
  sum += max(0.0, logOC - log(max(edlDepth(uv + vec2( 0.0, radius) * texelSize), 1e-6)));
  sum += max(0.0, logOC - log(max(edlDepth(uv + vec2( 0.0,-radius) * texelSize), 1e-6)));
  float shade = exp(-sum * strength);
  outputColor = vec4(inputColor.rgb * shade, inputColor.a);
}
`;

class EyeDomeLightingEffectImpl extends Effect {
  constructor({ strength = 0.9, radius = 1.4 } = {}) {
    super("EyeDomeLightingEffect", fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["strength", new THREE.Uniform(strength)],
        ["radius", new THREE.Uniform(radius)],
      ]),
    });
  }
  setStrength(v: number) { this.uniforms.get("strength")!.value = v; }
  setRadius(v: number) { this.uniforms.get("radius")!.value = v; }
}

export const EyeDomeLighting = wrapEffect(EyeDomeLightingEffectImpl);
