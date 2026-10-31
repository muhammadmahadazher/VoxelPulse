/** §25–28 band-packing tests: raw vs display separation, RGB/RGBA/scalar
 *  paths, nodata alpha, dtype normalization, pseudocolor endpoints. */
import { describe, it, expect } from "vitest";
import { packTileRgba, DEFAULT_RASTER_STYLE, type RasterStyle } from "./bands";

const style = (over?: Partial<RasterStyle>): RasterStyle => ({ ...DEFAULT_RASTER_STYLE, ...over });

describe("packTileRgba (§26)", () => {
  it("scalar uint8 → grayscale identity (no fabricated stretch)", () => {
    const rgba = packTileRgba({
      raw: new Uint8Array([0, 64, 128, 255]), width: 2, height: 2, samples: 1,
      sampleType: "uint8", style: style(),
    })!;
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBe(64);
    expect(rgba[8]).toBe(128);
    expect(rgba[12]).toBe(255);
    expect(rgba[3]).toBe(255); // opaque
  });

  it("RGB interleaved → correct channel mapping", () => {
    const raw = new Uint8Array([
      255, 0, 0,   0, 255, 0,
      0, 0, 255,   10, 20, 30,
    ]);
    const rgba = packTileRgba({
      raw, width: 2, height: 2, samples: 3, sampleType: "uint8", style: style(),
    })!;
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([255, 0, 0]);
    expect([rgba[4], rgba[5], rgba[6]]).toEqual([0, 255, 0]);
    expect([rgba[8], rgba[9], rgba[10]]).toEqual([0, 0, 255]);
    expect([rgba[12], rgba[13], rgba[14]]).toEqual([10, 20, 30]);
  });

  it("RGBA: band-3 alpha drives display alpha (×255/255 for uint8)", () => {
    const raw = new Uint8Array([
      255, 0, 0, 255,   255, 0, 0, 0,
    ]);
    const rgba = packTileRgba({
      raw, width: 2, height: 1, samples: 4, sampleType: "uint8", style: style(),
    })!;
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it("nodata → transparent when nodataTransparent (§28)", () => {
    const raw = new Float32Array([100.5, -9999]);
    const rgba = packTileRgba({
      raw, width: 2, height: 1, samples: 1, sampleType: "float32",
      nodata: [-9999], style: style(),
    })!;
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it("float32 elevation: raw values never quantized into the raw path — display stretch only touches RGBA", () => {
    const raw = new Float32Array([100, 200, 300, 400]);
    const rgba = packTileRgba({
      raw, width: 2, height: 2, samples: 1, sampleType: "float32", style: style(),
    })!;
    // tile-measured min/max = 100..400 → normalized ramp
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBeGreaterThan(0);
    expect(rgba[4]).toBeLessThan(255);
    expect(rgba[12]).toBe(255);
  });

  it("explicit dataset stretch is honored over the tile fallback", () => {
    const raw = new Float32Array([0, 50, 100, 150]);
    const rgba = packTileRgba({
      raw, width: 2, height: 2, samples: 1, sampleType: "float32",
      style: style({ stretch: { min: 0, max: 100 } }),
    })!;
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBeGreaterThanOrEqual(127); // midpoint → mid-gray (±1)
    expect(rgba[4]).toBeLessThanOrEqual(128);
    expect(rgba[8]).toBe(255);
    expect(rgba[12]).toBe(255); // clamped above max
  });

  it("uint16 normalizes by bit depth without a stretch", () => {
    const raw = new Uint16Array([0, 32768, 65535, 65535]);
    const rgba = packTileRgba({
      raw, width: 2, height: 2, samples: 1, sampleType: "uint16", style: style(),
    })!;
    expect(rgba[0]).toBe(0);
    expect(rgba[4]).toBeGreaterThanOrEqual(127); // midpoint → mid-gray (±1)
    expect(rgba[4]).toBeLessThanOrEqual(128);
    expect(rgba[8]).toBe(255);
  });

  it("pseudocolor maps low→dark blue, high→red endpoints", () => {
    const raw = new Uint8Array([0, 255]);
    const rgba = packTileRgba({
      raw, width: 2, height: 1, samples: 1, sampleType: "uint8",
      style: style({ mode: "pseudocolor" }),
    })!;
    expect(rgba[0]).toBeLessThan(80);   // blue channel dominant
    expect(rgba[2]).toBeGreaterThan(rgba[0]);
    expect(rgba[4]).toBeGreaterThan(200); // red endpoint
    expect(rgba[6]).toBeGreaterThan(rgba[5]);
  });

  it("RGB band remap picks explicit bands", () => {
    const raw = new Uint8Array([1, 2, 3]);
    const rgba = packTileRgba({
      raw, width: 1, height: 1, samples: 3, sampleType: "uint8",
      style: style({ mode: "rgb", rgbBands: [2, 1, 0] }),
    })!;
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([3, 2, 1]);
  });

  it("insufficient input returns null (guard, not garbage)", () => {
    expect(packTileRgba({
      raw: new Uint8Array([1, 2]), width: 2, height: 2, samples: 1,
      sampleType: "uint8", style: style(),
    })).toBeNull();
  });
});
