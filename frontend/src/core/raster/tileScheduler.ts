/** Raster tile scheduling (§16–18): pure, testable. Schedules in PIXEL space
 *  against the full affine geotransform — rotated/skewed rasters produce
 *  world-space quads, never silently north-up rectangles (§42). Overview
 *  levels carry their REAL dimensions from the file (§13: factors are
 *  measured, not assumed to be powers of two). Separate from the COPC
 *  scheduler (§6: raster tile pyramid ≠ point octree). */
import type { DatasetId } from "../data/ids";
import type { GeoTransform } from "./transform";
import { pixelToWorld, transformBounds, transformResolution } from "./transform";

export interface Bounds2D {
  min: [number, number];
  max: [number, number];
}

export interface MapViewport {
  /** Visible world-space bounds in PROJECT coordinates. */
  bounds: Bounds2D;
  /** Viewport size in pixels. */
  width: number;
  height: number;
}

/** One overview level with dimensions measured from the actual file. */
export interface OverviewLevel {
  /** Rounded divisor full.width / overview.width (integer for GDAL overviews). */
  factor: number;
  width: number;
  height: number;
}

export interface RasterSchedulerInput {
  datasetId: string;
  /** Full-resolution pixel size. */
  width: number;
  height: number;
  /** Full affine geotransform (GDAL order; rotation preserved). */
  geotransform: GeoTransform;
  /** Available overviews ascending by factor; empty = full resolution only. */
  overviews: OverviewLevel[];
  tileSize: { width: number; height: number };
  viewport: MapViewport;
  /** Max texels resident per raster (budget, §52). */
  texelBudget: number;
}

export interface ScheduledTile {
  key: string;
  /** Overview factor of this tile (1 = full res). */
  factor: number;
  tileX: number;
  tileY: number;
  /** Pixel window in the referenced level's image: [c0, r0, c1, r1) —
   *  overview pixel units (multiply by factor for full-res pixels). */
  px: [number, number, number, number];
  /** World-space quad corners, pixel-corner convention:
   *  [ (c0,r0), (c1,r0), (c1,r1), (c0,r1) ] through the affine. */
  quad: [[number, number], [number, number], [number, number], [number, number]];
  /** AABB of the quad — conservative culling bounds. */
  bounds: Bounds2D;
  priority: "critical" | "normal";
}

export interface SchedulerResult {
  tiles: ScheduledTile[];
  /** Coarse fallback tiles to KEEP while finer ones load (§18). */
  fallbacks: string[];
  /** Selected overview factor — 1 = full resolution. */
  factor: number;
}

/** World extent of one full-resolution texel (per axis magnitude). */
function fullTexel(gt: GeoTransform): { x: number; y: number } {
  const r = transformResolution(gt);
  return { x: r.x || 1, y: r.y || 1 };
}

function levelFor(overviews: OverviewLevel[], width: number, height: number, factor: number): OverviewLevel {
  if (factor === 1) return { factor: 1, width, height };
  return overviews.find((o) => o.factor === factor) ?? { factor, width: width / factor, height: height / factor };
}

/** Choose the overview FACTOR whose texel size best matches the viewport:
 *  1 screen px should sample ≈1 texel (§17). Zoomed-in → full res. */
export function selectOverview(
  full: { width: number; height: number },
  geotransform: GeoTransform,
  overviews: OverviewLevel[],
  viewport: MapViewport,
): number {
  const worldPerPixel = (viewport.bounds.max[0] - viewport.bounds.min[0]) / viewport.width;
  const texel = fullTexel(geotransform);
  const neededFactor = worldPerPixel / texel.x;
  // largest available factor ≤ needed: texel size ≤ screen px, so imagery is
  // never blurred beyond the screen's resolving power; zoomed-in → full res.
  let best = 1;
  for (const o of overviews) {
    if (o.factor <= neededFactor) best = o.factor;
  }
  return best;
}

function intersect(a: Bounds2D, b: Bounds2D): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
         a.min[1] <= b.max[1] && a.max[1] >= b.min[1];
}

function quadAabb(quad: ScheduledTile["quad"]): Bounds2D {
  const xs = quad.map((c) => c[0]);
  const ys = quad.map((c) => c[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/** World quad + AABB of a pixel rect at the given factor (§42: through the
 *  affine, rotation preserved). Rect is in the level's pixel units. */
export function tileQuad(
  gt: GeoTransform,
  factor: number,
  c0: number, r0: number, c1: number, r1: number,
): { quad: ScheduledTile["quad"]; bounds: Bounds2D } {
  const quad: ScheduledTile["quad"] = [
    pixelToWorld(gt, c0 * factor, r0 * factor),
    pixelToWorld(gt, c1 * factor, r0 * factor),
    pixelToWorld(gt, c1 * factor, r1 * factor),
    pixelToWorld(gt, c0 * factor, r1 * factor),
  ];
  return { quad, bounds: quadAabb(quad) };
}

/** Compute the tiles for one raster at the selected overview level. */
export function scheduleTiles(input: RasterSchedulerInput): SchedulerResult {
  const { datasetId, width, height, geotransform, overviews, tileSize, viewport } = input;
  const factor = selectOverview({ width, height }, geotransform, overviews, viewport);

  // §13: real level dims — never a re-derived guess
  const level = levelFor(overviews, width, height, factor);
  const ovW = Math.max(1, Math.round(level.width));
  const ovH = Math.max(1, Math.round(level.height));

  const tilesX = Math.ceil(ovW / tileSize.width);
  const tilesY = Math.ceil(ovH / tileSize.height);

  const tiles: ScheduledTile[] = [];
  const fallbacks: string[] = [];
  const vpc = {
    x: (viewport.bounds.min[0] + viewport.bounds.max[0]) / 2,
    y: (viewport.bounds.min[1] + viewport.bounds.max[1]) / 2,
  };
  const vw = viewport.bounds.max[0] - viewport.bounds.min[0];

  const emit = (f: number, tx: number, ty: number, out: ScheduledTile[], asFallback: boolean): void => {
    const lvl = levelFor(overviews, width, height, f);
    const lW = Math.max(1, Math.round(lvl.width));
    const lH = Math.max(1, Math.round(lvl.height));
    const c0 = Math.min(tx * tileSize.width, lW);
    const r0 = Math.min(ty * tileSize.height, lH);
    const c1 = Math.min((tx + 1) * tileSize.width, lW);
    const r1 = Math.min((ty + 1) * tileSize.height, lH);
    if (c1 <= c0 || r1 <= r0) return;
    const { quad, bounds } = tileQuad(geotransform, f, c0, r0, c1, r1);
    if (!intersect(bounds, viewport.bounds)) return; // §20: offscreen tiles skip
    const key = `${datasetId}#${f}/${tx}/${ty}`;
    if (asFallback) { fallbacks.push(key); return; }
    const cx = (bounds.min[0] + bounds.max[0]) / 2 - vpc.x;
    const cy = (bounds.min[1] + bounds.max[1]) / 2 - vpc.y;
    const central = Math.hypot(cx, cy) < vw * 0.25; // §27-style priority
    out.push({
      key, factor: f, tileX: tx, tileY: ty,
      px: [c0, r0, c1, r1], quad, bounds,
      priority: central ? "critical" : "normal",
    });
  };

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      emit(factor, tx, ty, tiles, false);
    }
  }

  // §18: one level coarser (the next LARGER real factor) remains as fallback
  const coarser = overviews
    .map((o) => o.factor)
    .filter((f) => f > factor)
    .sort((a, b) => a - b)[0];
  if (coarser !== undefined) {
    const cLevel = levelFor(overviews, width, height, coarser);
    const cW = Math.max(1, Math.round(cLevel.width));
    const cH = Math.max(1, Math.round(cLevel.height));
    const cTilesX = Math.ceil(cW / tileSize.width);
    const cTilesY = Math.ceil(cH / tileSize.height);
    for (let ty = 0; ty < cTilesY; ty++) {
      for (let tx = 0; tx < cTilesX; tx++) {
        emit(coarser, tx, ty, tiles, true);
      }
    }
  }

  return { tiles, fallbacks, factor };
}

/** Pixel-budget guard (§52): a level whose full tile set exceeds the texel
 *  budget is not schedulable at full res — scheduler picks overviews first. */
export function texelCountAtLevel(width: number, height: number, factor: number): number {
  return Math.ceil(width / factor) * Math.ceil(height / factor);
}

/** Full-res footprint AABB of the raster (works for rotated affines). */
export function rasterFootprint(
  gt: GeoTransform,
  width: number,
  height: number,
): Bounds2D {
  return transformBounds(gt, width, height);
}
