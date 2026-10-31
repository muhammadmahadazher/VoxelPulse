/** Scientific hillshade (CP7): per-pixel relief shading from REAL elevation
 *  gradients — Horn central differences with world-space texel spacing.
 *  Spacing is always in METRES: projected CRS use the geotransform directly;
 *  geographic (degree) CRS convert via the local latitude (never assume
 *  degrees are metres). Pure and fully testable. */
import type { GeoTransform } from "./transform";

export interface HillshadeParams {
  /** Sun azimuth in degrees clockwise from north (0..360). */
  azimuth: number;
  /** Sun elevation above horizon in degrees (0..90). */
  elevation: number;
  /** Texel spacing in METRES (x, y). */
  spacingX: number;
  spacingY: number;
  /** Optional vertical unit scale (elevations are metres already → 1). */
  zScale?: number;
}

/** Horn 3×3 gradients at one pixel. Returns null when any neighbor is
 *  non-finite (nodata edge → no fabricated shading). */
export function hornGradient(
  at: (col: number, row: number) => number | null,
  spacingX: number,
  spacingY: number,
): { dzdx: number; dzdy: number } | null {
  const a = at(-1, -1), b = at(0, -1), c = at(1, -1);
  const d = at(-1, 0), e = 0, f = at(1, 0);
  const g = at(-1, +1), h = at(0, +1), i = at(1, +1);
  void e;
  if ([a, b, c, d, f, g, h, i].some((v) => v === null || !Number.isFinite(v))) return null;
  const dzdx = ((c as number) + 2 * (f as number) + (i as number) -
                (a as number) - 2 * (d as number) - (g as number)) / (8 * spacingX);
  const dzdy = ((g as number) + 2 * (h as number) + (i as number) -
                (a as number) - 2 * (b as number) - (c as number)) / (8 * spacingY);
  return { dzdx, dzdy };
}

/** Hillshade 0..1 for one gradient. Gradient axes: +x = east, +y = SOUTH
 *  (raster rows). Standard formula with compass downslope aspect:
 *  shade = cos(zenith)·cos(slope) + sin(zenith)·sin(slope)·cos(azimuth − aspect). */
export function shadeFromGradient(
  dzdx: number,
  dzdy: number,
  azimuth: number,
  elevation: number,
): number {
  const dzdE = dzdx;
  const dzdN = -dzdy; // raster rows run south → flip to north-up compass
  const zen = (90 - elevation) * (Math.PI / 180);
  const az = azimuth * (Math.PI / 180);
  const slope = Math.atan(Math.hypot(dzdE, dzdN));
  // downslope compass direction (0=N, 90=E): horizontal −∇z
  const aspect = Math.atan2(-dzdE, -dzdN);
  const s = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(az - aspect);
  return Math.max(0, Math.min(1, s));
}

/** Full-tile hillshade 0..1 per pixel. Nodata pixels (and pixels whose 3×3
 *  neighborhood contains nodata) yield 0 → transparent when packed with
 *  nodata awareness. */
export function hillshadeTile(
  raw: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array,
  bufWidth: number,
  height: number,
  samples: number,
  params: HillshadeParams,
  nodata?: number,
): Float32Array | null {
  const width = bufWidth;
  if (width < 3 || height < 3 || samples <= 0) return null;
  const out = new Float32Array(width * height);
  const at = (c: number, r: number): number | null => {
    if (c < 0 || r < 0 || c >= width || r >= height) return null;
    const v = Number(raw[(r * width + c) * samples]);
    if (!Number.isFinite(v)) return null;
    if (nodata !== undefined && v === nodata) return null;
    return v;
  };
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const g = hornGradient(
        (dc, dr) => at(c + dc, r + dr),
        params.spacingX || 1, params.spacingY || 1,
      );
      out[r * width + c] = g
        ? shadeFromGradient(g.dzdx, g.dzdy, params.azimuth, params.elevation)
        : 0;
    }
  }
  return out;
}

/** Metres-per-texel for a raster: projected CRS → |affine| directly;
 *  geographic (degree) CRS → degrees converted at the raster's mean latitude
 *  (cos-latitude east/west compression; R = 6371008.8 m). */
export function texelSizeInMetres(
  gt: GeoTransform,
  crsUnit: "metre" | "degree" | string,
  meanLatitudeDeg: number,
): { x: number; y: number } {
  const ax = Math.hypot(gt.a, gt.d);
  const ay = Math.hypot(gt.b, gt.e);
  if (crsUnit === "degree") {
    const R = 6371008.8;
    const k = Math.PI / 180;
    const lat = Math.max(-89.5, Math.min(89.5, meanLatitudeDeg));
    return { x: ax * k * R * Math.cos(lat * k), y: ay * k * R };
  }
  return { x: ax, y: ay };
}