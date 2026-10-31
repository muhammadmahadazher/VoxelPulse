/** GeoTIFF adapter (§12): content-first detection, metadata inspection and
 *  decode through geotiff.js — with ALL byte reads routed through the
 *  VoxelPulse DataSource via GeoTIFF.fromSource (ADR-0009: geotiff's own
 *  HTTP remote client is never used). Raw georeferencing tags come from a
 *  bounded header window via our own IFD reader — geotiff.js v3 defers geo
 *  tags and would flatten ModelTransformation (losing rotation). */
import type { DataSource, SourceDescriptorLike } from "../../source/types";
import type { DataFormat } from "../../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "../types";
import { VpDataError } from "../../errors";
import { spatialReferenceRegistry } from "../../../spatial/registry";
import { UNKNOWN_REFERENCE } from "../../../spatial/reference";
import type { RasterDescriptor, RasterOverview, SampleType } from "../../../raster/model";
import { validateRasterDescriptor } from "../../../raster/model";
import { validateTransform, transformBounds, type GeoTransform } from "../../../raster/transform";
import { readGeoTags, geotransformFromTags, epsgFromGeoKeyDirectory, type RawGeoTags } from "./rawtags";
import { newDatasetId } from "../../ids";
import { VpGeoTIFFSource } from "../../../raster/vpSource";

const TIFF_EXT = /\.(tif|tiff|gtiff)$/i;

/** COG ghost-area signature (GDAL structural metadata, first bytes before
 *  IFD0 of a Cloud Optimized GeoTIFF). */
const COG_GHOST = "GDAL_STRUCTURAL_METADATA";

function geotiffProbe(ctx: ProbeContext): ProbeResult {
  // TIFF magic: "II" + 42 (little-endian) or "MM" + 42 (big-endian);
  // BigTIFF: "II" + 43 / "MM" + 43.
  const b = ctx.header;
  if (b.length < 8) return { confidence: TIFF_EXT.test(ctx.filename ?? "") ? 0.1 : 0, reason: "too short" };
  const byteOrder = b[0] === 0x49 && b[1] === 0x49 ? "le" : b[0] === 0x4d && b[1] === 0x4d ? "be" : null;
  if (!byteOrder) return { confidence: TIFF_EXT.test(ctx.filename ?? "") ? 0.1 : 0, reason: "no TIFF magic" };
  const magic = byteOrder === "le" ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3];
  if (magic !== 42 && magic !== 43) {
    return { confidence: TIFF_EXT.test(ctx.filename ?? "") ? 0.1 : 0, reason: "not a TIFF version" };
  }
  let confidence = 0.7;
  if (TIFF_EXT.test(ctx.filename ?? "")) confidence = Math.min(1, confidence + 0.15);
  return { confidence, format: "geotiff", reason: "TIFF magic" };
}

/** Map TIFF SampleFormat code + bits to our SampleType. */
function sampleFormatName(format: number, bits: number): string {
  const map: Record<string, string> = {
    "1/8": "Uint8", "1/16": "Uint16", "1/32": "Uint32",
    "2/8": "Int8", "2/16": "Int16", "2/32": "Int32",
    "3/32": "Float32", "3/64": "Float64",
  };
  return map[`${format}/${bits}`] ?? "Uint8";
}

/** Map a geotiff.js sample format string to our SampleType. */
function toSampleType(gtType: string): SampleType {
  switch (gtType) {
    case "Uint8": return "uint8";
    case "Int8": return "int8";
    case "Uint16": return "uint16";
    case "Int16": return "int16";
    case "Uint32": return "uint32";
    case "Int32": return "int32";
    case "Float32": return "float32";
    case "Float64": return "float64";
    default: return "uint8";
  }
}

/** Geotransform from geotiff.js-parsed fileDirectory tags — fallback when the
 *  raw IFD window didn't reach the tags. geotiff.js v3 parses ModelPixelScale
 *  (33550), ModelTiepoint (33922) and ModelTransformation (34264) into
 *  deferred arrays; when resolvable they give the full affine. */
function geotransformFromFileDirectory(
  fd: Record<string, unknown>,
  fallbackOrigin: number[],
  fallbackResolution: number[],
): GeoTransform | null {
  // ModelTransformation (4×4, row-major): world = M · [pixel, row, 0, 1]
  const mt = fd?.ModelTransformation;
  if (Array.isArray(mt) && mt.length >= 16) {
    const m = mt as number[];
    const gt: GeoTransform = { a: m[0], b: m[4], c: m[3], d: m[1], e: m[5], f: m[7] };
    if (Number.isFinite(gt.a) && Number.isFinite(gt.e)) return gt;
  }
  const scale = fd?.ModelPixelScale;
  const tie = fd?.ModelTiepoint;
  if (Array.isArray(scale) && scale.length >= 2 && Array.isArray(tie) && tie.length >= 6) {
    const gt: GeoTransform = {
      a: scale[0] as number, b: 0, c: tie[3] as number,
      d: 0, e: -(scale[1] as number), f: tie[4] as number,
    };
    if (Number.isFinite(gt.a) && Number.isFinite(gt.e) && gt.a !== 0 && gt.e !== 0) return gt;
  }
  if (fallbackResolution?.length >= 2 && fallbackOrigin?.length >= 2) {
    return {
      a: fallbackResolution[0], b: 0, c: fallbackOrigin[0],
      d: 0, e: -Math.abs(fallbackResolution[1]), f: fallbackOrigin[1],
    };
  }
  return null;
}

/** Inspect an opened geotiff.js image into a RasterDescriptor. */
async function descriptorFromImage(
  id: import("../../../data/ids").DatasetId,
  name: string,
  source: SourceDescriptorLike,
  image: import("geotiff").GeoTIFFImage,
  overviews: RasterOverview[],
  layout: "cog" | "tiled" | "stripped",
  raw: RawGeoTags | null,
): Promise<RasterDescriptor> {
  // §9: georeferencing — raw tags first (rotation preserved); deferred
  // fileDirectory arrays as the fallback; never a guess. (ImageFileDirectory
  // has no string index signature — widen for the tag lookup.)
  const fd = image.fileDirectory as unknown as Record<string, unknown>;
  const gt: GeoTransform | null =
    (raw ? geotransformFromTags(raw) : null) ??
    geotransformFromFileDirectory(fd, image.getOrigin(), image.getResolution());
  if (!gt) {
    throw new VpDataError("invalid-data", "GeoTIFF has no usable georeferencing (ModelPixelScale/Tiepoint/Transformation).");
  }
  validateTransform(gt);

  const crsFromKeys = raw ? epsgFromGeoKeyDirectory(raw.geoKeyDirectory) : undefined;

  const compressionNames: Record<number, string> = {
    1: "none", 5: "lzw", 8: "deflate", 7: "jpeg", 32946: "deflate",
    50000: "zstd", 32773: "packbits", 2: "ccitt", 6: "old-jpeg",
  };
  const fdCompression = fd?.Compression;
  const compression = typeof fdCompression === "number"
    ? (compressionNames[fdCompression] ?? `tiff-code-${fdCompression}`)
    : "unknown";

  const nodata = await image.getGDALNoData();
  const bandNodata = nodata !== null && nodata !== undefined && Number.isFinite(nodata) ? nodata : undefined;

  const footprint = transformBounds(gt, image.getWidth(), image.getHeight());
  const desc: RasterDescriptor = {
    id,
    name,
    width: image.getWidth(),
    height: image.getHeight(),
    bandCount: image.getSamplesPerPixel(),
    sampleType: toSampleType(sampleFormatName(image.getSampleFormat(0), image.getBitsPerSample(0))),
    bands: Array.from({ length: image.getSamplesPerPixel() }, (_, i) => ({
      index: i,
      type: toSampleType(sampleFormatName(image.getSampleFormat(i), image.getBitsPerSample(i))),
      nodata: bandNodata,
    })),
    geotransform: gt,
    crs: crsFromKeys ?? "VP:UNKNOWN",
    tileSize: image.isTiled ? { width: image.getTileWidth(), height: image.getTileHeight() } : undefined,
    overviews,
    compression,
    cloudOptimized: layout === "cog",
    source,
    spatialReference: crsFromKeys
      ? (() => {
          try {
            return {
              reference: spatialReferenceRegistry.resolve(crsFromKeys),
              source: "embedded" as const,
              detail: "GeoTIFF geokeys",
            };
          } catch (e) {
            return {
              reference: UNKNOWN_REFERENCE,
              source: "embedded" as const,
              detail: `CRS "${crsFromKeys}" not in bundled registry: ${(e as Error).message.slice(0, 80)}`,
            };
          }
        })()
      : { reference: UNKNOWN_REFERENCE, source: "none" as const, detail: "no GeoTIFF CRS keys" },
    metadata: {
      layout,
      photometric: raw?.modelTransformation ? "transform-present" : undefined,
      footprint,
    },
  };
  validateRasterDescriptor(desc);
  return desc;
}

/** Bounded header window we read for raw-tag parsing + ghost sniffing. TIFF
 *  IFDs usually live near the start; when they don't, georeferencing falls
 *  back to the deferred fileDirectory arrays (never a whole-file read). */
const HEAD_WINDOW = 512 * 1024;

export const geotiffAdapter: FormatAdapter = {
  id: "geotiff" as DataFormat,
  label: "GeoTIFF / COG raster",

  probe: geotiffProbe,

  async inspect(source, signal) {
    try {
      if (signal?.aborted) throw new VpDataError("cancelled", "Cancelled");

      // bounded window for raw tags + ghost sniff (read through the DataSource)
      const size = await source.size().catch(() => undefined);
      const headLen = Math.min(size ?? HEAD_WINDOW, HEAD_WINDOW);
      const head = await source.read({ offset: 0, length: headLen }, signal);
      const headBytes = new Uint8Array(head);
      if (!geotiffProbe({ header: headBytes, filename: source.descriptor().name }).confidence) {
        throw new VpDataError("invalid-data", "Not a TIFF file (missing II*/MM* magic).");
      }

      // structure via geotiff.js over the SAME DataSource (byte ranges only)
      const { default: GeoTIFF } = await import("geotiff");
      const vpSource = new VpGeoTIFFSource(source);
      const tiff = await GeoTIFF.fromSource(vpSource as never, undefined, signal);
      const image = (await tiff.getImage()) as never as Awaited<ReturnType<typeof tiff.getImage>>;

      const raw = readGeoTags(head);
      const count = await tiff.getImageCount();
      // real overview dims from the actual images (§13 — never assumed 2^i)
      const overviews: RasterOverview[] = [];
      for (let i = 1; i < count; i++) {
        const ov = await tiff.getImage(i);
        const w = ov.getWidth(), h = ov.getHeight();
        if (w >= image.getWidth()) continue; // not an overview (mask/multi-page)
        const factor = Math.max(1, Math.round(image.getWidth() / Math.max(1, w)));
        overviews.push({ factor, width: w, height: h });
      }
      overviews.sort((a, b) => a.factor - b.factor);

      // COG verification (§13): ghost signature + tiled + overviews ordered.
      // Tiled alone is NOT a COG — "GDAL_STRUCTURAL_METADATA" in the header
      // window is the verifying evidence.
      const ghost = headBytes.length > 16 && new TextDecoder().decode(headBytes.subarray(0, Math.min(1024, headBytes.length))).includes(COG_GHOST);
      const tiled = image.isTiled === true;
      const layout: "cog" | "tiled" | "stripped" =
        ghost && tiled && overviews.length > 0 ? "cog"
        : tiled ? "tiled"
        : "stripped";

      const desc = await descriptorFromImage(
        newDatasetId(),
        source.descriptor().name ?? source.label,
        source.descriptor(),
        image,
        overviews,
        layout,
        raw,
      );

      return {
        name: desc.name,
        format: "geotiff" as DataFormat,
        kind: "raster" as const,
        metadata: {
          sourceName: desc.name,
          sourceSizeBytes: size,
          pointCount: undefined,
          bounds: undefined,
          fields: [],
          createdAt: new Date().toISOString(),
          spatialReference: desc.spatialReference,
          formatSpecific: {
            raster: { ...desc, id: undefined, source: undefined } as unknown as Record<string, unknown>,
          },
        },
        chunkCount: 0,
      };
    } catch (e) {
      if (e instanceof VpDataError) throw e;
      throw new VpDataError("invalid-data", `Could not inspect ${source.label} as GeoTIFF.`, {
        detail: (e as Error).message?.slice(0, 200),
      });
    }
  },

  async open() {
    // §52-54: raster rendering attaches through the raster streaming runtime;
    // whole-file decode is not the adapter's job (B: the opened-dataset
    // contract dispatches on kind === "raster" in the import service).
    throw new VpDataError("unsupported-format",
      "GeoTIFF/COG rasters render through the raster runtime (Map/Terrain workspaces).");
  },
};
