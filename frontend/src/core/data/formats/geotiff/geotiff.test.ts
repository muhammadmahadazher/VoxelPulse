/** §57/§58: GeoTIFF adapter tests against deterministic fixtures —
 *  detection, metadata correctness, malformed input handling. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { geotiffAdapter } from "./adapter";
import { formatRegistry } from "../registry";
import { registerBuiltinAdapters } from "../index";
import { MemorySource } from "../../source/memory";
import { VpDataError } from "../../errors";

const FIX = ["../../../../../tests/fixtures", "../../../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "gray.tif")))!;

const ab = (name: string) => {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(() => registerBuiltinAdapters());

describe("GeoTIFF detection (§12: content-first)", () => {
  it("detects TIFF magic with high confidence regardless of extension", async () => {
    const src = new MemorySource(ab("gray.tif"), "gray.tif");
    const det = await formatRegistry.detect(src);
    expect(det.adapter.id).toBe("geotiff");
    expect(det.probe.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("detects TIFF content with a wrong extension (content wins)", async () => {
    const src = new MemorySource(ab("gray.tif"), "mystery.dat");
    const det = await formatRegistry.detect(src);
    expect(det.adapter.id).toBe("geotiff");
  });

  it("does not claim a TIFF extension with non-TIFF content (§57)", async () => {
    const xyz = readFileSync(join(FIX, "tiny.xyz"));
    const src = new MemorySource(
      xyz.buffer.slice(xyz.byteOffset, xyz.byteOffset + xyz.byteLength) as ArrayBuffer,
      "points.tif",
    );
    const det = await formatRegistry.detect(src);
    expect(det.adapter.id).not.toBe("geotiff");
  });
});

describe("GeoTIFF metadata (§48)", () => {
  it("grayscale fixture: correct dimensions, transform, CRS", async () => {
    const src = new MemorySource(ab("gray.tif"), "gray.tif");
    const info = await geotiffAdapter.inspect(src);
    const raster = info.metadata.formatSpecific?.raster as unknown as import("../../raster/model").RasterDescriptor;
    expect(raster.width).toBe(64);
    expect(raster.height).toBe(64);
    expect(raster.bandCount).toBe(1);
    expect(raster.geotransform.a).toBe(10);    // 10m pixels
    expect(raster.geotransform.e).toBe(-10);   // north-up
    expect(raster.geotransform.c).toBe(500000);
    expect(raster.geotransform.f).toBe(4000000);
    expect(raster.crs).toBe("EPSG:32643");
    expect(info.metadata.spatialReference?.reference.id).toBe("EPSG:32643");
    expect(info.metadata.spatialReference?.source).toBe("embedded");
  });

  it("RGB fixture: 3 bands, photometric RGB", async () => {
    const src = new MemorySource(ab("rgb.tif"), "rgb.tif");
    const info = await geotiffAdapter.inspect(src);
    const raster = info.metadata.formatSpecific?.raster as unknown as import("../../raster/model").RasterDescriptor;
    expect(raster.bandCount).toBe(3);
  });

  it("Float32 DEM fixture: sample type + nodata + CRS (§30)", async () => {
    const src = new MemorySource(ab("dem-f32.tif"), "dem-f32.tif");
    const info = await geotiffAdapter.inspect(src);
    const raster = info.metadata.formatSpecific?.raster as unknown as import("../../raster/model").RasterDescriptor;
    expect(raster.sampleType).toBe("float32");
    expect(raster.bands[0].nodata).toBe(-9999);
    expect(raster.crs).toBe("EPSG:32643");
  });

  it("nodata DEM fixture: nodata propagated (§28)", async () => {
    const src = new MemorySource(ab("dem-nodata.tif"), "dem-nodata.tif");
    const info = await geotiffAdapter.inspect(src);
    const raster = info.metadata.formatSpecific?.raster as unknown as import("../../raster/model").RasterDescriptor;
    expect(raster.bands[0].nodata).toBe(-9999);
  });

  it("rotated fixture: affine rotation preserved (§9, §42)", async () => {
    const src = new MemorySource(ab("rotated.tif"), "rotated.tif");
    const info = await geotiffAdapter.inspect(src);
    const raster = info.metadata.formatSpecific?.raster as unknown as import("../../raster/model").RasterDescriptor;
    // ModelTransformation with 30° rotation — b/d coefficients nonzero
    expect(raster.geotransform.b).not.toBe(0);
    expect(raster.geotransform.d).not.toBe(0);
  });

});

describe("malformed input (§56)", () => {
  it("malformed TIFF → structured error via registry (no crash)", async () => {
    const src = new MemorySource(ab("malformed.tif"), "malformed.tif");
    const err = await formatRegistry.inspectAs(src, "geotiff").catch((e) => e);
    expect(err).toBeInstanceOf(VpDataError);
    expect(["invalid-data", "unsupported-format", "decode-failed"]).toContain(err.code);
  });

  it("truncated TIFF (magic only + garbage) → structured error", async () => {
    const buf = new ArrayBuffer(20);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true);
    const src = new MemorySource(buf, "truncated.tif");
    const err = await formatRegistry.inspectAs(src, "geotiff").catch((e) => e);
    expect(err).toBeInstanceOf(VpDataError);
  });

  it("adapter open() refuses whole-file decode (rendering attaches elsewhere)", async () => {
    const src = new MemorySource(ab("gray.tif"), "gray.tif");
    await expect(geotiffAdapter.open(src)).rejects.toMatchObject({ code: "unsupported-format" });
  });
});
