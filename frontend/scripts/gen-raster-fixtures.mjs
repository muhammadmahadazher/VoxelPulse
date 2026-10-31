#!/usr/bin/env node
/** Phase 5 §57: deterministic raster fixtures via the geotiff.js writer.
 *  Generates: grayscale, RGB, Float32 DEM, nodata DEM, rotated affine,
 *  tiled raster, and a malformed TIFF. Run from frontend/. */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeArrayBuffer } from "geotiff";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(OUT, { recursive: true });

const W = 64, H = 64;

/** Deterministic pattern in [0,1]. */
const pat = (i) => ((i % W) / W + ((i / W) | 0) / H) / 2;

async function main() {
  // 1. grayscale uint8, north-up 10m pixels, known EPSG CRS
  {
    const data = new Uint8Array(W * H);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(pat(i) * 255);
    const buf = writeArrayBuffer(data, {
      width: W, height: H,
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500000, 4000000, 0],
      ProjectedCSTypeGeoKey: 32643,
    });
    writeFileSync(join(OUT, "gray.tif"), new Uint8Array(buf));
  }

  // 2. RGB uint8
  {
    const data = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      data[i * 3] = Math.round(pat(i) * 255);
      data[i * 3 + 1] = Math.round(((i % W) / W) * 255);
      data[i * 3 + 2] = Math.round((((i / W) | 0) / H) * 255);
    }
    const buf = writeArrayBuffer(data, {
      width: W, height: H, SamplesPerPixel: 3, PhotometricInterpretation: 2,
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500000, 4000000, 0],
    });
    writeFileSync(join(OUT, "rgb.tif"), new Uint8Array(buf));
  }

  // 3. Float32 single-band DEM (elevation ramp + wave)
  {
    const data = new Float32Array(W * H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        data[r * W + c] = 200 + 50 * Math.sin(c / 8) + 30 * Math.cos(r / 6) + c * 0.5;
      }
    }
    const buf = writeArrayBuffer(data, {
      width: W, height: H, BitsPerSample: [32], SampleFormat: [3],
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500000, 4000000, 0],
      ProjectedCSTypeGeoKey: 32643,
      GDAL_NODATA: "-9999",
    });
    writeFileSync(join(OUT, "dem-f32.tif"), new Uint8Array(buf));
  }

  // 4. nodata DEM — ramp with a circular nodata hole
  {
    const data = new Float32Array(W * H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const dxc = c - 32, dyr = r - 32;
        data[r * W + c] = dxc * dxc + dyr * dyr < 64 ? -9999 : 200 + c * 0.5;
      }
    }
    const buf = writeArrayBuffer(data, {
      width: W, height: H, BitsPerSample: [32], SampleFormat: [3],
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500000, 4000000, 0],
      GDAL_NODATA: "-9999",
    });
    writeFileSync(join(OUT, "dem-nodata.tif"), new Uint8Array(buf));
  }

  // 5. rotated affine — ModelTransformation with 30° rotation
  {
    const data = new Uint8Array(W * H);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(pat(i) * 255);
    const theta = Math.PI / 6;
    const s = 10, cs = s * Math.cos(theta), sn = s * Math.sin(theta);
    const buf = writeArrayBuffer(data, {
      width: W, height: H,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 500000, 4000000, 0],
      ModelTransformation: [cs, sn, 0, 500000, -sn, cs, 0, 4000000, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    writeFileSync(join(OUT, "rotated.tif"), new Uint8Array(buf));
  }

  // 6. tiled COG fixture: geotiff.js writeArrayBuffer is strip-only, so the
  // tiled COG fixture comes from the real COG in the §53 scale gate; the
  // local suite covers strip-based rasters + malformed input.

  // 7. malformed/truncated TIFF — valid magic + garbage IFD
  {
    const bad = new Uint8Array(48);
    bad[0] = 0x49; bad[1] = 0x49; bad[3] = 42;
    bad.set([0xde, 0xad, 0xbe, 0xef], 4);
    for (let i = 8; i < 48; i++) bad[i] = (i * 37) & 0xff;
    writeFileSync(join(OUT, "malformed.tif"), bad);
  }

  console.log("raster fixtures written to", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
