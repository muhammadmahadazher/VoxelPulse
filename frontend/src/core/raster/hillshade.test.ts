/** CP7 hillshade tests — expected values computed independently (analytic
 *  trigonometry). */
import { describe, it, expect } from "vitest";
import { shadeFromGradient, hillshadeTile, texelSizeInMetres } from "./hillshade";

const D2R = Math.PI / 180;

describe("shadeFromGradient (CP7)", () => {
  it("flat surface → shade = sin(elevation)", () => {
    expect(shadeFromGradient(0, 0, 315, 45)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("surface rising eastward (normal leans west): sun WEST lights it, sun EAST shades it", () => {
    // z = 0.5·E → slope atan(0.5) = 26.565°, downslope = WEST (270°)
    expect(shadeFromGradient(0.5, 0, 270, 45)).toBeCloseTo(Math.cos((45 - 26.565) * D2R), 4);
    expect(shadeFromGradient(0.5, 0, 90, 45)).toBeCloseTo(Math.cos((45 + 26.565) * D2R), 4);
  });

  it("surface descending northward: sun due north lights it", () => {
    // dzdN = −0.5 (falls toward north → normal leans north)
    // raster dzdy = −dzdN = +0.5
    expect(shadeFromGradient(0, 0.5, 0, 45)).toBeCloseTo(Math.cos((45 - 26.565) * D2R), 4);
  });

  it("vertical sun → shade = cos(slope) regardless of azimuth", () => {
    expect(shadeFromGradient(0.5, 0.5, 0, 90)).toBeCloseTo(Math.cos(Math.atan(Math.hypot(0.5, 0.5))), 6);
    expect(shadeFromGradient(1, 5, 137, 90)).toBeCloseTo(Math.cos(Math.atan(Math.hypot(1, 5))), 6);
  });
});

describe("hillshadeTile (CP7)", () => {
  it("tilted plane → constant analytic shade across interior pixels", () => {
    const w = 8, h = 8;
    const raw = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) raw[r * w + c] = 0.5 * c + 0.25 * r;
    }
    const shade = hillshadeTile(raw, w, h, 1, { azimuth: 90, elevation: 45, spacingX: 1, spacingY: 1 })!;
    expect(shade).not.toBeNull();
    // independent analytic value: dzdE = 0.5, dzdN = −0.25 →
    // slope = atan(hypot) , aspect = atan2(−0.5, 0.25), az − aspect = 153.435°
    const slope = Math.atan(Math.hypot(0.5, 0.25));
    const expected = Math.max(0, Math.min(1,
      Math.cos(D2R * 45) * Math.cos(slope) +
      Math.sin(D2R * 45) * Math.sin(slope) * Math.cos(D2R * (90 - (Math.atan2(-0.5, 0.25) / D2R)))));
    for (let r = 1; r < h - 1; r++) {
      for (let c = 1; c < w - 1; c++) {
        expect(shade[r * w + c]).toBeCloseTo(expected, 6);
      }
    }
  });

  it("nodata neighborhood → 0 (no fabricated shading at edges)", () => {
    const w = 4, h = 4;
    const raw = new Float32Array(w * h);
    raw.fill(10);
    raw[0] = -9999;
    const shade = hillshadeTile(raw, w, h, 1, { azimuth: 315, elevation: 45, spacingX: 1, spacingY: 1 }, -9999)!;
    expect(shade[0]).toBe(0);          // nodata pixel itself
    expect(shade[1]).toBe(0);          // neighbor of nodata
    expect(shade[2 * w + 2]).toBeCloseTo(Math.SQRT1_2, 5); // interior: flat, window nodata-free
  });

  it("degree CRS: 0.001° at lat 60 → ≈55.6 m east-west texel", () => {
    const t = texelSizeInMetres(
      { a: 0.001, b: 0, c: 17, d: 0, e: -0.001, f: 60 },
      "degree", 60,
    );
    expect(t.x).toBeCloseTo(55.6, 0);
    expect(t.y).toBeCloseTo(111.2, 0);
  });

  it("projected CRS: spacing is the affine magnitude directly", () => {
    const t = texelSizeInMetres({ a: 10, b: 0, c: 0, d: 0, e: -10, f: 0 }, "metre", 0);
    expect(t.x).toBe(10);
    expect(t.y).toBe(10);
  });
});
