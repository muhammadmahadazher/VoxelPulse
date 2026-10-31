/** §42/§58: numerical tests for the affine geotransform — authoritative
 *  expected values, not round-trips alone. */
import { describe, it, expect } from "vitest";
import {
  pixelToWorld, worldToPixel, pixelCenterToWorld, transformCorners, transformBounds,
  transformResolution, isNorthUp, validateTransform, composeTransform, invertTransform,
  type GeoTransform,
} from "./transform";

/** Classic UTM north-up: 100m pixels, origin (500000, 4000000), E < 0. */
const NORTH_UP: GeoTransform = { a: 100, b: 0, c: 500000, d: 0, e: -100, f: 4000000 };

/** Rotated/skewed: 45° rotation, 10m pixels. */
const ROTATED: GeoTransform = {
  a: 10 * Math.SQRT1_2, b: 10 * Math.SQRT1_2,
  c: 1000, d: -10 * Math.SQRT1_2, e: 10 * Math.SQRT1_2, f: 2000,
};

describe("pixel ↔ world (§42)", () => {
  it("north-up: pixel (0,0) is the TOP-LEFT corner at the transform origin", () => {
    const [x, y] = pixelToWorld(NORTH_UP, 0, 0);
    expect(x).toBe(500000);
    expect(y).toBe(4000000);
  });

  it("north-up: X grows with column, Y DECREASES with row (E < 0, §42)", () => {
    const [x, y] = pixelToWorld(NORTH_UP, 3, 2);
    expect(x).toBe(500000 + 300);
    expect(y).toBe(4000000 - 200);
  });

  it("pixel-center convention: center of (0,0) is half a pixel in", () => {
    const [x, y] = pixelCenterToWorld(NORTH_UP, 0, 0);
    expect(x).toBe(500050);
    expect(y).toBe(3999950);
  });

  it("worldToPixel inverts exactly (no 1px drift, §42)", () => {
    for (const [c, r] of [[0, 0], [17, 4], [1023, 767], [3.5, 9.25]] as const) {
      const [x, y] = pixelToWorld(NORTH_UP, c, r);
      const [pc, pr] = worldToPixel(NORTH_UP, x, y);
      expect(pc).toBeCloseTo(c, 10);
      expect(pr).toBeCloseTo(r, 10);
    }
  });

  it("rotated/skewed: rotation is preserved, not discarded (§9)", () => {
    // pixel (1,0) of ROTATED: +10m along the rotated column axis (45°)
    const [x, y] = pixelToWorld(ROTATED, 1, 0);
    expect(x).toBeCloseTo(1000 + 10 * Math.SQRT1_2, 10);
    expect(y).toBeCloseTo(2000 - 10 * Math.SQRT1_2, 10);
    const [x2, y2] = pixelToWorld(ROTATED, 0, 1);
    expect(x2).toBeCloseTo(1000 + 10 * Math.SQRT1_2, 10);
    expect(y2).toBeCloseTo(2000 + 10 * Math.SQRT1_2, 10);
  });

  it("rotated: worldToPixel inverts", () => {
    const [x, y] = pixelToWorld(ROTATED, 13.7, 4.2);
    const [c, r] = worldToPixel(ROTATED, x, y);
    expect(c).toBeCloseTo(13.7, 8);
    expect(r).toBeCloseTo(4.2, 8);
  });

  it("degenerate transform throws", () => {
    const degenerate: GeoTransform = { a: 1, b: 2, c: 0, d: 2, e: 4, f: 0 }; // rows parallel
    expect(() => worldToPixel(degenerate, 1, 1)).toThrow(/degenerate/);
    expect(() => validateTransform(degenerate)).toThrow(/degenerate/);
  });
});

describe("corners, bounds, resolution", () => {
  it("north-up corners are the axis-aligned footprint", () => {
    const corners = transformCorners(NORTH_UP, 100, 50);
    expect(corners[0]).toEqual([500000, 4000000]);       // top-left
    expect(corners[1]).toEqual([510000, 4000000]);       // top-right
    expect(corners[2]).toEqual([510000, 3995000]);       // bottom-right
    expect(corners[3]).toEqual([500000, 3995000]);       // bottom-left
    const b = transformBounds(NORTH_UP, 100, 50);
    expect(b.min).toEqual([500000, 3995000]);
    expect(b.max).toEqual([510000, 4000000]);
  });

  it("rotated bounds exceed the axis-aligned pixel box (rotation-aware, §9)", () => {
    const b = transformBounds(ROTATED, 100, 100);
    const sizeX = b.max[0] - b.min[0];
    expect(sizeX).toBeGreaterThan(100 * 10 * Math.SQRT1_2); // wider than unrotated
  });

  it("resolution is units/pixel", () => {
    expect(transformResolution(NORTH_UP)).toEqual({ x: 100, y: 100 });
    expect(isNorthUp(NORTH_UP)).toBe(true);
    expect(isNorthUp(ROTATED)).toBe(false);
  });

  it("composeTransform: overview transform composes with full", () => {
    // overview at factor 4 in PIXEL space (rows grow downward in both
    // spaces, so the pixel-space scale is positive): overview (1,1) = full (4,4)
    const overview: GeoTransform = { a: 4, b: 0, c: 0, d: 0, e: 4, f: 0 };
    const composed = composeTransform(NORTH_UP, overview);
    const [x, y] = pixelToWorld(composed, 1, 1);
    expect(x).toBe(500000 + 400);
    expect(y).toBe(4000000 - 400);
  });

  it("invertTransform inverts composition", () => {
    const inv = invertTransform(ROTATED);
    const [x, y] = pixelToWorld(ROTATED, 5, 7);
    const [c, r] = pixelToWorld(inv, x, y);
    expect(c).toBeCloseTo(5, 8);
    expect(r).toBeCloseTo(7, 8);
  });

  it("validateTransform rejects non-finite and out-of-range values", () => {
    expect(() => validateTransform({ a: NaN, b: 0, c: 0, d: 0, e: -1, f: 0 })).toThrow(/non-finite/);
    expect(() => validateTransform({ a: 1e13, b: 0, c: 0, d: 0, e: -1, f: 0 })).toThrow(/out of range/);
    expect(() => validateTransform(NORTH_UP)).not.toThrow();
  });
});
