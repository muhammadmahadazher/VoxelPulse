/** Raster tile scheduling (§16–18): pure, testable. Given the raster
 *  footprint in PROJECT space, available overviews, the map viewport and a
 *  pixel budget, produce the tiles to load (prioritized) and the fallback
 *  tiles to retain. Reuses scheduler priority lanes but is a SEPARATE
 *  scheduler from COPC (§6: raster tile pyramid ≠ point octree). */
import type { DatasetId } from "../data/ids";

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

export interface RasterSchedulerInput {
  datasetId: string;
  /** Full-resolution pixel size. */
  width: number;
  height: number;
  /** Available overview factors ascending (2,4,8...); empty = full only. */
  overviewFactors: number[];
  tileSize: { width: number; height: number };
  /** Project-space bounds of the full raster footprint. */
  footprint: Bounds2D;
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

/** Choose the overview FACTOR whose texel size best matches the viewport:
 *  1 screen px should sample ≈1 texel (§17). Factor 1 = full resolution.
 *  Zoomed-in viewports get factor 1; zoomed-out get the coarsest overview
 *  whose texels don't undersample the screen. */
export function selectOverview(
  footprint: Bounds2D,
  full: { width: number; height: number },
  overviewFactors: number[],
  viewport: MapViewport,
): number {
  const worldPerPixel = (viewport.bounds.max[0] - viewport.bounds.min[0]) / viewport.width;
  const fullResWorldPerPixel = (footprint.max[0] - footprint.min[0]) / full.width;
  const neededFactor = Math.round(worldPerPixel / fullResWorldPerPixel);
  // largest factor ≤ needed: texel size ≤ screen px, so imagery is never
  // blurred beyond the screen's resolving power; zoomed-in → full res.
  let best = 1;
  for (const f of overviewFactors) {
    if (f <= neededFactor) best = f;
  }
  return best;
}

function intersect(a: Bounds2D, b: Bounds2D): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
         a.min[1] <= b.max[1] && a.max[1] >= b.min[1];
}

/** Compute the tiles for one raster at the given overview level. */
export function scheduleTiles(input: RasterSchedulerInput): SchedulerResult {
  const { datasetId, width, height, overviewFactors, tileSize, footprint, viewport } = input;
  const factor = selectOverview(footprint, { width, height }, overviewFactors, viewport);
  const ovW = Math.max(1, Math.ceil(width / factor));
  const ovH = Math.max(1, Math.ceil(height / factor));

  // world extent of one overview texel
  const texelW = (footprint.max[0] - footprint.min[0]) / ovW;
  const texelH = (footprint.max[1] - footprint.min[1]) / ovH;
  const tilesX = Math.ceil(ovW / tileSize.width);
  const tilesY = Math.ceil(ovH / tileSize.height);

  const tiles: ScheduledTile[] = [];
  const fallbacks: string[] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const b: Bounds2D = {
        min: [footprint.min[0] + tx * tileSize.width * texelW, footprint.min[1] + ty * tileSize.height * texelH],
        max: [
          footprint.min[0] + Math.min((tx + 1) * tileSize.width, ovW) * texelW,
          footprint.min[1] + Math.min((ty + 1) * tileSize.height, ovH) * texelH,
        ],
      };
      if (!intersect(b, viewport.bounds)) continue; // §20: offscreen tiles skip
      const key = `${datasetId}#${factor}/${tx}/${ty}`;
      // §27-style priority: tiles near the viewport center first
      const cx = (b.min[0] + b.max[0]) / 2 - (viewport.bounds.min[0] + viewport.bounds.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2 - (viewport.bounds.min[1] + viewport.bounds.max[1]) / 2;
      const vw = viewport.bounds.max[0] - viewport.bounds.min[0];
      const central = Math.hypot(cx, cy) < vw * 0.25;
      tiles.push({ key, factor, tileX: tx, tileY: ty, bounds: b, priority: central ? "critical" : "normal" });
    }
  }

  // §18: tiles from one factor coarser remain as fallbacks while these load
  if (factor > 1) {
    const coarseFactor = factor * 2;
    const cW = Math.max(1, Math.ceil(width / coarseFactor));
    const cH = Math.max(1, Math.ceil(height / coarseFactor));
    const cTexelW = (footprint.max[0] - footprint.min[0]) / cW;
    const cTexelH = (footprint.max[1] - footprint.min[1]) / cH;
    const cTilesX = Math.ceil(cW / tileSize.width);
    const cTilesY = Math.ceil(cH / tileSize.height);
    for (let ty = 0; ty < cTilesY; ty++) {
      for (let tx = 0; tx < cTilesX; tx++) {
        const b: Bounds2D = {
          min: [footprint.min[0] + tx * tileSize.width * cTexelW, footprint.min[1] + ty * tileSize.height * cTexelH],
          max: [
            footprint.min[0] + Math.min((tx + 1) * tileSize.width, cW) * cTexelW,
            footprint.min[1] + Math.min((ty + 1) * tileSize.height, cH) * cTexelH,
          ],
        };
        if (intersect(b, viewport.bounds)) {
          fallbacks.push(`${datasetId}#${factor * 2}/${tx}/${ty}`);
        }
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
