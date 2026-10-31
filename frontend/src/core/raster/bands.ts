/** Raster band handling (§25–28): the boundary between RAW pixel values and
 *  DISPLAY colors. Raw interleaved samples are never modified — elevation
 *  analysis, probing and terrain sampling always read the raw buffer; this
 *  module only packs display RGBA. Handles scalar / grayscale / RGB / RGBA,
 *  nodata masks, and Uint8…Float64 sample types (§26: scientific values are
 *  never quantized into the analysis path). */
import type { SampleType } from "./model";

export type RawSamples =
  | Uint8Array | Int8Array | Uint16Array | Int16Array
  | Uint32Array | Int32Array | Float32Array | Float64Array;

export type RasterStyleMode = "auto" | "rgb" | "grayscale" | "pseudocolor";

export interface RasterStyle {
  mode: RasterStyleMode;
  /** Band indices for RGB mapping (default 0,1,2 when ≥3 bands). */
  rgbBands?: [number, number, number];
  /** Display stretch bounds — REAL measured dataset statistics (§29: no
   *  fabricated stats). When absent: uint8/uint16 normalize by bit depth,
   *  float types fall back to the tile's own measured min/max. */
  stretch?: { min: number; max: number };
  /** Data alpha (RGBA band) × this → final opacity is applied by the
   *  renderer material; packing bakes only data-derived alpha. */
  nodataTransparent: boolean;
}

export const DEFAULT_RASTER_STYLE: RasterStyle = {
  mode: "auto",
  nodataTransparent: true,
};

export interface PackInput {
  /** Interleaved samples of one tile; row stride = `stride` pixels (defaults
   *  to width — the runtime buffer may be +1 wider for terrain seams). */
  raw: RawSamples;
  width: number;
  height: number;
  /** Row stride in pixels (≥ width). Default: width. */
  stride?: number;
  samples: number;
  sampleType: SampleType;
  /** Per-band nodata values (index = band). */
  nodata?: Array<number | undefined>;
  style: RasterStyle;
}

/** Pack one tile's raw samples into an RGBA display buffer (0..255).
 *  Alpha: 255, or 0 for nodata pixels when style.nodataTransparent, or the
 *  RGBA band-3 alpha when present. Returns null for empty input. */
export function packTileRgba(input: PackInput): Uint8ClampedArray | null {
  const { raw, width, height, samples, sampleType, nodata, style } = input;
  const stride = input.stride ?? width;
  const count = width * height;
  if (count === 0 || samples <= 0 || raw.length < (stride * (height - 1) + width) * samples) return null;

  const out = new Uint8ClampedArray(count * 4);
  const bandCount = samples;

  // resolved display mode (§25: auto = RGB for ≥3 bands, else grayscale)
  let mode = style.mode;
  if (mode === "auto") mode = bandCount >= 3 ? "rgb" : "grayscale";

  // stretch function: raw value → normalized 0..1
  const stretch = resolveStretch(style.stretch, sampleType, raw, samples, stride);

  // per-band nodata lookup closure
  const isNodata = nodata && nodata.some((v) => v !== undefined)
    ? (values: Array<number>, band: number) => {
        const nv = nodata[band];
        return nv !== undefined && values[band] === nv;
      }
    : null;

  const values: number[] = new Array(bandCount);
  let o = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const base = (row * stride + col) * samples;
      for (let b = 0; b < bandCount; b++) values[b] = Number(raw[base + b]);

      let rr = 0, gg = 0, bb = 0, a = 255;

      if (mode === "rgb") {
        const rb = style.rgbBands ?? [0, 1, 2];
        rr = stretch(values[rb[0]] ?? 0);
        gg = stretch(values[rb[1] ?? 1] ?? 0);
        bb = stretch(values[rb[2] ?? 2] ?? 0);
        if (bandCount >= 4) {
          // RGBA: band 3 carries data alpha (× bit depth)
          a = Math.round((values[3] as number) * (255 / (bitMax(sampleType) || 255)));
        }
      } else if (mode === "grayscale") {
        const v = stretch(values[0]);
        rr = gg = bb = v;
      } else {
        // pseudocolor: normalized band 0 through the perceptual ramp
        const t = stretch(values[0]);
        const idx = Math.min(TURBO.length - 1, Math.max(0, Math.round(t * (TURBO.length - 1))));
        [rr, gg, bb] = TURBO[idx];
      }

      if (isNodata?.(values, 0) || (mode === "rgb" && bandCount >= 4 && isNodata?.(values, 3))) {
        if (style.nodataTransparent) a = 0;
      }

      out[o] = rr; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = a;
      o += 4;
    }
  }
  return out;
}

/** Normalize a raw value to 0..255 for display. Resolution order:
 *  1. explicit style.stretch (measured dataset stats),
 *  2. integer types normalize by bit depth (lossless display identity),
 *  3. float types fall back to the tile's own measured min/max. */
function resolveStretch(
  stretch: RasterStyle["stretch"],
  sampleType: SampleType,
  raw: RawSamples,
  samples: number,
  stride: number,
): (v: number) => number {
  if (stretch && Number.isFinite(stretch.max - stretch.min) && stretch.max > stretch.min) {
    const { min, max } = stretch;
    const k = 255 / (max - min);
    return (v) => Math.min(255, Math.max(0, Math.round((v - min) * k)));
  }
  if (isFloat(sampleType)) {
    // measured tile min/max over band 0 (deterministic scan, stride-aware)
    const width = stride;
    let min = Infinity, max = -Infinity;
    for (let p = 0; p < raw.length / samples; p++) {
      const r = Math.floor(p / width), c = p % width;
      const v = Number(raw[(r * width + c) * samples]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const k = 255 / (max - min);
      return (v) => Math.min(255, Math.max(0, Math.round((v - min) * k)));
    }
    return () => 128;
  }
  const denom = bitMax(sampleType) || 255;
  const k = 255 / denom;
  return (v) => Math.min(255, Math.max(0, Math.round(v * k)));
}

function isFloat(t: SampleType): boolean {
  return t === "float32" || t === "float64";
}

function bitMax(t: SampleType): number {
  switch (t) {
    case "uint8": return 255;
    case "int8": return 127;
    case "uint16": return 65535;
    case "int16": return 32767;
    case "uint32": return 4294967295;
    case "int32": return 2147483647;
    default: return 0;
  }
}

/** Turbo approximation — 32 evenly sampled stops of the Google Turbo ramp
 *  (dark blue → cyan → green → yellow → red). Display-only. */
const TURBO: Array<[number, number, number]> = [
  [48, 18, 59], [70, 37, 133], [104, 54, 176], [137, 68, 201], [170, 79, 210],
  [201, 88, 205], [227, 96, 187], [246, 104, 162], [254, 114, 136], [252, 126, 111],
  [241, 142, 88], [223, 159, 68], [199, 177, 54], [172, 193, 47], [144, 208, 48],
  [117, 221, 58], [94, 232, 76], [76, 240, 100], [63, 244, 128], [56, 244, 158],
  [56, 240, 187], [63, 231, 212], [77, 218, 231], [95, 202, 243], [116, 184, 247],
  [138, 165, 246], [159, 146, 239], [178, 127, 227], [193, 109, 210], [204, 92, 189],
  [210, 77, 166], [208, 66, 143],
];
