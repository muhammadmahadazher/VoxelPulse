/** CP4B fixture: build a REAL tiled Cloud Optimized GeoTIFF by hand (geotiff.js
 *  writeArrayBuffer is strip-only). Deterministic bytes; deterministic RGB
 *  pattern; EPSG:32643 geokeys; north-up 10 m texels anchored at 500000 E /
 *  4000000 N; ghost area + full-res IFD first + 2×/4× overview IFDs after —
 *  verified COG layout. Run: node scripts/gen-cog-fixture.mjs
 *  Output: tests/fixtures/cog-rgb-ov.tif (committed — regenerate + sha256 to
 *  verify determinism). */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "cog-rgb-ov.tif");

const FULL = 32;   // 32×32 full res
const TILE = 16;   // 16×16 tiles → 2×2 at full res
const BANDS = 3;
const LEVELS = [32, 16, 8]; // factors 1, 2, 4

function pixel(level, x, y) {
  const f = 32 / LEVELS[level];
  const X = Math.min(31, Math.floor(x * f));
  const Y = Math.min(31, Math.floor(y * f));
  return [(X * 8) & 255, (Y * 8) & 255, 128];
}

function tileBytes(level) {
  // TIFF edge tiles are padded to TileWidth×TileLength
  const buf = new Uint8Array(TILE * TILE * BANDS);
  const dim = LEVELS[level];
  let p = 0;
  for (let ty = 0; ty < TILE; ty++) {
    for (let tx = 0; tx < TILE; tx++) {
      const gx = tx, gy = ty;
      if (gx < dim && gy < dim) {
        const [r, g, b] = pixel(level, gx, gy);
        buf[p] = r; buf[p + 1] = g; buf[p + 2] = b;
      }
      p += BANDS;
    }
  }
  return buf;
}

/** One 16×16 tile of level `level` at tile coords (tx,ty). */
function tileData(level, tx, ty) {
  const buf = new Uint8Array(TILE * TILE * BANDS);
  const dim = LEVELS[level];
  let p = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const gx = tx * TILE + x, gy = ty * TILE + y;
      if (gx < dim && gy < dim) {
        const [r, g, b] = pixel(level, gx, gy);
        buf[p] = r; buf[p + 1] = g; buf[p + 2] = b;
      }
      p += BANDS;
    }
  }
  return buf;
}

const nTiles = (dim) => Math.ceil(dim / TILE) ** 2;

function buildTiff() {
  const GHOST_LEN = 100;
  const IFD_SIZE = 2 + 14 * 12 + 4;
  const tilesPer = LEVELS.map((d) => nTiles(d));            // [4, 1, 1]
  const extSizes = LEVELS.map((_, i) =>
    6 + 4 * tilesPer[i] + 4 * tilesPer[i] + 24 + 48 + 32);  // bits+offs+cnts+scale+tie+keys
  const tileBytesLen = (i) => tilesPer[i] * TILE * TILE * BANDS;

  // ---- pass 1: layout
  let cursor = 8 + GHOST_LEN;
  const layout = LEVELS.map((_, i) => {
    const ifdOff = cursor;
    const extOff = ifdOff + IFD_SIZE;
    const dataOff = extOff + extSizes[i];
    cursor = dataOff + tileBytesLen(i);
    return { ifdOff, extOff, dataOff };
  });
  const total = cursor;

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  // ---- header
  buf[0] = 0x49; buf[1] = 0x49;              // "II"
  dv.setUint16(2, 42, true);
  dv.setUint32(4, layout[0].ifdOff, true);

  // ---- ghost area (COG structural metadata)
  const ghostText = "GDAL_STRUCTURAL_METADATA\nLAYOUT=COG\n";
  for (let i = 0; i < GHOST_LEN; i++) buf[8 + i] = 0x20; // pad spaces
  for (let i = 0; i < ghostText.length; i++) buf[8 + i] = ghostText.charCodeAt(i);
  buf[8 + ghostText.length] = 0x00;

  // ---- per-level blocks
  for (let l = 0; l < LEVELS.length; l++) {
    const { ifdOff, extOff, dataOff } = layout[l];
    const n = tilesPer[l];
    const tileFileOffsets = Array.from({ length: n }, (_, i) => dataOff + i * TILE * TILE * BANDS);

    // externals (fixed order): bits(6), tileOffsets(4n), tileCounts(4n),
    // scale(24), tiepoint(48), geokeys(32)
    const extBase = extOff;
    const offBits = extBase;
    const offTOff = offBits + 6;
    const offTCnt = offTOff + 4 * n;
    const offScale = offTCnt + 4 * n;
    const offTie = offScale + 24;
    const offKeys = offTie + 48;

    dv.setUint16(offBits + 0, 8, true);
    dv.setUint16(offBits + 2, 8, true);
    dv.setUint16(offBits + 4, 8, true);
    for (let i = 0; i < n; i++) dv.setUint32(offTOff + 4 * i, tileFileOffsets[i], true);
    for (let i = 0; i < n; i++) dv.setUint32(offTCnt + 4 * i, TILE * TILE * BANDS, true);
    dv.setFloat64(offScale + 0, 10, true);
    dv.setFloat64(offScale + 8, 10, true);
    dv.setFloat64(offScale + 16, 0, true);
    dv.setFloat64(offTie + 0, 0, true);
    dv.setFloat64(offTie + 8, 0, true);
    dv.setFloat64(offTie + 16, 0, true);
    dv.setFloat64(offTie + 24, 500000, true);
    dv.setFloat64(offTie + 32, 4000000, true);
    dv.setFloat64(offTie + 40, 0, true);
    const keys = [1, 1, 0, 3, 1024, 0, 1, 1, 3072, 0, 1, 32643, 2048, 0, 1, 4326];
    keys.forEach((k, i) => dv.setUint16(offKeys + 2 * i, k, true));

    // tile data
    const tilesX = Math.ceil(LEVELS[l] / TILE);
    for (let ty = 0; ty < tilesX; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const idx = ty * tilesX + tx;
        buf.set(tileData(l, tx, ty), dataOff + idx * TILE * TILE * BANDS);
    }
    }

    // IFD (written after data so the offsets are all known — position is fixed)
    const entries = [
      [256, 4, 1, LEVELS[l]],          // ImageWidth LONG
      [257, 4, 1, LEVELS[l]],          // ImageLength LONG
      [258, 3, 3, offBits],            // BitsPerSample → ext
      [259, 3, 1, 1],                  // Compression none
      [262, 3, 1, 2],                  // Photometric RGB
      [277, 3, 1, 3],                  // SamplesPerPixel
      [284, 3, 1, 1],                  // PlanarConfiguration chunky
      [322, 3, 1, TILE],               // TileWidth
      [323, 3, 1, TILE],               // TileLength
      [324, 4, n, offTOff],            // TileOffsets → ext
      [325, 4, n, offTCnt],            // TileByteCounts → ext
      [33550, 12, 3, offScale],        // ModelPixelScale
      [33922, 12, 6, offTie],          // ModelTiepoint
      [34735, 3, 16, offKeys],         // GeoKeyDirectory
    ];
    const nextIfd = l + 1 < LEVELS.length ? layout[l + 1].ifdOff : 0;
    dv.setUint16(ifdOff, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const e = ifdOff + 2 + i * 12;
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(e + 8, value, true);
      else dv.setUint32(e + 8, value, true);
    });
    dv.setUint32(ifdOff + 2 + entries.length * 12, nextIfd, true);
  }

  return buf;
}

writeFileSync(OUT, buildTiff());
console.log("wrote", OUT, buildTiff().length, "bytes");
