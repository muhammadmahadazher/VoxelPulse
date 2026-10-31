/** Raster dataset descriptor + tile model (§8, §15). Serializable metadata
 *  only — pixels live in the raster runtime/resources. */
import type { DatasetId } from "../data/ids";
import type { SourceDescriptorLike } from "../data/source/types";
import type { SpatialReferenceInfo } from "../spatial/reference";
import type { GeoTransform } from "./transform";

export type SampleType =
  | "uint8" | "uint16" | "uint32" | "int8" | "int16" | "int32"
  | "float32" | "float64" | "cint16" | "cint32" | "cfloat32" | "cfloat64";

export type RasterCompression =
  | "none" | "lzw" | "deflate" | "jpeg" | "webp" | "zstd" | "lerc" | "packbits" | "ccitt" | "old-jpeg" | string;

export interface RasterBand {
  index: number; // 0-based
  type: SampleType;
  nodata?: number;
  /** Scale/offset for packed ints (e.g. elevation in cm). */
  scale?: number;
  offset?: number;
  name?: string;
}

export interface RasterOverview {
  /** Overview factor relative to full resolution (2, 4, 8...). */
  factor: number;
  width: number;
  height: number;
}

export interface RasterDescriptor {
  id: DatasetId;
  name: string;
  width: number;
  height: number;
  bandCount: number;
  bands: RasterBand[];
  sampleType: SampleType;
  geotransform: GeoTransform;
  /** Source CRS id (canonical, e.g. "EPSG:32643") — resolved via the registry. */
  crs: string;
  tileSize?: { width: number; height: number };
  overviews: RasterOverview[];
  compression: RasterCompression;
  /** True when the file is a Cloud Optimized GeoTIFF (tiled + overviews). */
  cloudOptimized: boolean;
  source: SourceDescriptorLike;
  spatialReference?: SpatialReferenceInfo;
  metadata?: Record<string, unknown>;
}

/** §15: one tile of one overview level. */
export interface RasterTile {
  datasetId: DatasetId;
  overviewLevel: number; // index into RasterDescriptor.overviews (0 = full res)
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  /** Project-space bounds (after CRS transform) — computed, not assumed square. */
  bounds: { min: [number, number]; max: [number, number] };
}

/** Validate raster dimensions/counts before any allocation (§56). */
export function validateRasterDescriptor(d: RasterDescriptor): void {
  if (!Number.isInteger(d.width) || d.width <= 0 || d.width > 1e6) {
    throw new Error(`invalid raster width: ${d.width}`);
  }
  if (!Number.isInteger(d.height) || d.height <= 0 || d.height > 1e6) {
    throw new Error(`invalid raster height: ${d.height}`);
  }
  if (!Number.isInteger(d.bandCount) || d.bandCount <= 0 || d.bandCount > 65536) {
    throw new Error(`invalid band count: ${d.bandCount}`);
  }
  if (d.overviews.length > 32) throw new Error("unreasonable overview count");
}

/** Pixel count of the full raster — allocation guard (§56, §99). */
export function rasterPixelCount(d: RasterDescriptor): number {
  const count = d.width * d.height;
  if (!Number.isSafeInteger(count) || count > 2 ** 32) {
    throw new Error("raster pixel count exceeds the safe allocation bound");
  }
  return count;
}
