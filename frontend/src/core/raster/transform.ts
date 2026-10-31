/** Raster dataset model (§7–9, Phase 5). A raster descriptor is serializable
 *  metadata — pixels never live here. The affine GeoTransform is the single
 *  source of truth for pixel↔world mapping (§9): every conversion is
 *  explicit, tested, and preserves rotation/skew. */

/** Affine geotransform, GDAL order:
 *  X = A·col + B·row + C
 *  Y = D·col + E·row + F
 *  col/row are PIXEL-CORNER indices (GDAL convention); pixel-center adds 0.5.
 *  North-up rasters: B = D = 0, E < 0. Rotated rasters keep B/D. */
export interface GeoTransform {
  a: number; // X per column
  b: number; // X per row (rotation/skew)
  c: number; // X origin (top-left corner)
  d: number; // Y per column (rotation/skew)
  e: number; // Y per row (negative for north-up)
  f: number; // Y origin (top-left corner)
}

export const IDENTITY_TRANSFORM: GeoTransform = { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 };

/** Pixel-corner (col,row) → world (source CRS). */
export function pixelToWorld(t: GeoTransform, col: number, row: number): [number, number] {
  return [t.a * col + t.b * row + t.c, t.d * col + t.e * row + t.f];
}

/** World → pixel-corner (col,row); continuous — floor for the containing
 *  pixel, round for the nearest pixel center. */
export function worldToPixel(t: GeoTransform, x: number, y: number): [number, number] {
  const det = t.a * t.e - t.b * t.d;
  if (Math.abs(det) < 1e-12) {
    throw new Error("degenerate geotransform (zero area)");
  }
  const dx = x - t.c;
  const dy = y - t.f;
  const col = (t.e * dx - t.b * dy) / det;
  const row = (-t.d * dx + t.a * dy) / det;
  return [col, row];
}

/** Pixel-center variant (§9): world coordinate of the center of pixel
 *  (col,row) — the standard for value sampling. */
export function pixelCenterToWorld(t: GeoTransform, col: number, row: number): [number, number] {
  return pixelToWorld(t, col + 0.5, row + 0.5);
}

/** Invert a transform (rare; used for rotated-frame helpers). */
export function invertTransform(t: GeoTransform): GeoTransform {
  const det = t.a * t.e - t.b * t.d;
  if (Math.abs(det) < 1e-12) throw new Error("degenerate geotransform");
  const ia = t.e / det;
  const ib = -t.b / det;
  const id = -t.d / det;
  const ie = t.a / det;
  // inverse of [A B; D E] × (p - origin)
  return { a: ia, b: ib, c: -(ia * t.c + ib * t.f), d: id, e: ie, f: -(id * t.c + ie * t.f) };
}

/** Compose two transforms: result maps pixel-space of `inner` through
 *  `outer`. Used for overview relative-to-full transforms. */
export function composeTransform(outer: GeoTransform, inner: GeoTransform): GeoTransform {
  // outer ∘ inner as 3x3 affine (a b c / d e f / 0 0 1)
  const a = outer.a * inner.a + outer.b * inner.d;
  const b = outer.a * inner.b + outer.b * inner.e;
  const c = outer.a * inner.c + outer.b * inner.f + outer.c;
  const d = outer.d * inner.a + outer.e * inner.d;
  const e = outer.d * inner.b + outer.e * inner.e;
  const f = outer.d * inner.c + outer.e * inner.f + outer.f;
  return { a, b, c, d, e, f };
}

/** Four corners (pixel-corner convention) of width×height raster. */
export function transformCorners(t: GeoTransform, width: number, height: number): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    pixelToWorld(t, 0, 0),
    pixelToWorld(t, width, 0),
    pixelToWorld(t, width, height),
    pixelToWorld(t, 0, height),
  ];
}

/** Axis-aligned bounds of the (possibly rotated) raster footprint. */
export function transformBounds(t: GeoTransform, width: number, height: number): { min: [number, number]; max: [number, number] } {
  const corners = transformCorners(t, width, height);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/** Pixel resolution (units/pixel) along each axis — meaningful for
 *  north-up; for rotated transforms this is the per-axis magnitude. */
export function transformResolution(t: GeoTransform): { x: number; y: number } {
  return { x: Math.hypot(t.a, t.d), y: Math.hypot(t.b, t.e) };
}

/** True when the transform is strictly north-up (no rotation/skew). */
export function isNorthUp(t: GeoTransform): boolean {
  return t.b === 0 && t.d === 0;
}

/** Validate: finite numbers, nonzero area, sane magnitude (§56). */
export function validateTransform(t: GeoTransform): void {
  for (const v of [t.a, t.b, t.c, t.d, t.e, t.f]) {
    if (!Number.isFinite(v)) throw new Error("geotransform contains non-finite values");
    if (Math.abs(v) > 1e12) throw new Error("geotransform value out of range");
  }
  if (Math.abs(t.a * t.e - t.b * t.d) < 1e-12) throw new Error("degenerate geotransform (zero area)");
}
