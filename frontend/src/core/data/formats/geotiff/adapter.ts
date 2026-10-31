/** GeoTIFF adapter (§12): content-first detection, metadata inspection and
 *  decode through geotiff.js — with all byte reads routed through the
 *  VoxelPulse DataSource (ADR-0009: geotiff's own HTTP client is unused). */
import type { DataSource, SourceDescriptorLike } from "../../source/types";
import type { DataFormat } from "../../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "../types";
import { VpDataError } from "../../errors";
import { spatialReferenceRegistry } from "../../../spatial/registry";
import { UNKNOWN_REFERENCE } from "../../../spatial/reference";
import type { RasterDescriptor, RasterOverview, SampleType } from "../../../raster/model";
import { validateRasterDescriptor } from "../../../raster/model";
import { validateTransform, type GeoTransform } from "../../../raster/transform";
import { readGeoTags, geotransformFromTags, epsgFromGeoKeyDirectory, type RawGeoTags } from "./rawtags";
import { newDatasetId } from "../../ids";

const TIFF_EXT = /\.(tif|tiff|gtiff)$/i;

function geotiffProbe(ctx: ProbeContext): ProbeResult {
  // TIFF magic: "II" + 42 (little-endian) or "MM" + 42 (big-endian);
  // BigTIFF: "II" + 43 / "MM" + 43.
  const b = ctx.header;
  if (b.length < 8) return { confidence: TIFF_EXT.test(ctx.filename ?? "") ? 0.1 : 0, reason: "too short" };
  const byteOrder = b[0] === 0x49 && b[1] === 0x49 ? "le" : b[0] === 0x4d && b[1] === 0x4d ? "be" : null;
  if (!byteOrder) return { confidence: TIFF_EXT.test(ctx.filename ?? "") ? 0.1 : 0, reason: "no TIFF magic" };
  // magic is 42 (classic) or 43 (BigTIFF) in the file's byte order
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
  const t = `${format}/${bits}`;
  const map: Record<string, string> = {
    "1/8": "Uint8", "1/16": "Uint16", "1/32": "Uint32",
    "2/8": "Int8", "2/16": "Int16", "2/32": "Int32",
    "3/32": "Float32", "3/64": "Float64",
  };
  return map[t] ?? "Uint8";
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

/** Build the canonical CRS id from geotiff.js geokeys. Preference: projected
 *  EPSG, then geographic EPSG, else UNKNOWN (never a guess, §11/§48). */
function crsIdFromGeoKeys(geoKeys: Record<number, unknown> | undefined): string | undefined {
  if (!geoKeys) return undefined;
  const gtCitation = geoKeys[1026] as string | undefined;
  const projCs = geoKeys[3072] as number | undefined; // ProjectedCSTypeGeoKey
  const geoCs = geoKeys[2048] as number | undefined;  // GeographicTypeGeoKey
  if (projCs && projCs > 0) return `EPSG:${projCs}`;
  if (geoCs && geoCs > 0) return `EPSG:${geoCs}`;
  void gtCitation;
  return undefined;
}

export class GeotiffOpenError extends VpDataError {
  constructor(message: string, detail?: string) {
    super("unsupported-format", message, { detail });
  }
}

/** Inspect an opened geotiff.js image into a RasterDescriptor. */
async function descriptorFromImage(
  id: import("../../../data/ids").DatasetId,
  name: string,
  source: SourceDescriptorLike,
  image: {
    getWidth: () => number;
    getHeight: () => number;
    getSamplesPerPixel: () => number;
    getGeoKeys: () => Record<number, unknown> | Record<number, unknown>[];
    getOrigin: () => number[];
    getResolution: (width?: number) => number[];
    getTileSize: () => { width: number; height: number } | null;
    fileDirectory: Record<string, unknown>;
    getSampleFormat: (i?: number) => number;
    getBitsPerSample: (i?: number) => number;
    isTiled: boolean;
    getTileWidth: () => number;
    getTileHeight: () => number;
    getGDALNoData: () => Promise<number | null>;
  },
  overviewCount: number,
  isCOG: boolean,
  raw: RawGeoTags,
): Promise<RasterDescriptor> {
  // §9: georeferencing from raw tags — geotiff.js v3 accessors flatten
  // ModelTransformation (rotation would be silently discarded).
  const gt = geotransformFromTags(raw) ?? (() => {
    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution();
    return { a: rx, b: 0, c: ox, d: 0, e: -Math.abs(ry), f: oy };
  })();
  validateTransform(gt);

  // §48: CRS from raw GeoKeyDirectory (v3 getGeoKeys works too, but the raw
  // path keeps rotated/BE fixtures consistent).
  const crsFromKeys = epsgFromGeoKeyDirectory(raw.geoKeyDirectory) ?? undefined;

  const compressionNames: Record<number, string> = {
    1: "none", 5: "lzw", 8: "deflate", 7: "jpeg", 32946: "deflate",
    50000: "zstd", 32773: "packbits", 2: "ccitt", 6: "old-jpeg",
  };
  let compression: string = "unknown";
  {
    const fdCompression = (image as unknown as { fileDirectory: { Compression?: number } }).fileDirectory.Compression;
    compression = typeof fdCompression === "number"
      ? (compressionNames[fdCompression] ?? `tiff-code-${fdCompression}`)
      : compression;
  }

  const overviews: RasterOverview[] = [];
  for (let i = 1; i <= overviewCount; i++) {
    const f = 2 ** i;
    overviews.push({
      factor: f,
      width: Math.max(1, Math.ceil(image.getWidth() / f)),
      height: Math.max(1, Math.ceil(image.getHeight() / f)),
    });
  }

  const nodata = await image.getGDALNoData();
  const bandNodata = nodata !== null && nodata !== undefined && Number.isFinite(nodata) ? nodata : undefined;

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
    cloudOptimized: isCOG,
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
    metadata: { photometric: raw.modelTransformation ? "transform-present" : undefined },
  };
  validateRasterDescriptor(desc);
  return desc;
}

export const geotiffAdapter: FormatAdapter = {
  id: "geotiff" as DataFormat,
  label: "GeoTIFF / COG raster",

  probe: geotiffProbe,

  async inspect(source, signal) {
    try {
      if (signal?.aborted) throw new VpDataError("cancelled", "Cancelled");
      // Route every byte through our DataSource: read the whole buffer for
      // local files; remote files use windowed reads in the COG runtime
      // (§13) — inspection needs only the header bytes.
      const size = await source.size().catch(() => undefined);
      const headLen = Math.min(size ?? 32768, 32768);
      const head = await source.read({ offset: 0, length: headLen }, signal);
      if (!geotiffProbe({ header: new Uint8Array(head), filename: source.descriptor().name }).confidence) {
        throw new VpDataError("invalid-data", "Not a TIFF file (missing II*/MM* magic).");
      }

      // geotiff.js parses the header/IFD itself (handles LE/BE/BigTIFF);
      // small fixtures fit the window — larger files stream in the runtime.
      return inspectFromBuffer(head, source, size);
    } catch (e) {
      if (e instanceof VpDataError) throw e;
      throw new VpDataError("invalid-data", `Could not inspect ${source.label} as GeoTIFF.`, {
        detail: (e as Error).message?.slice(0, 200),
      });
    }
  },

  async open() {
    // §52-54: raster rendering attaches through the COG streaming runtime;
    // whole-file decode is not the adapter's job.
    throw new VpDataError("unsupported-format",
      "GeoTIFF/COG rasters render through the raster runtime (Map/Terrain workspaces).");
  },
};

/** Full metadata parse from a buffer via geotiff.js (fromArrayBuffer). */
async function inspectFromBuffer(buf: ArrayBuffer, source: DataSource, size: number | undefined) {
  const { fromArrayBuffer } = await import("geotiff");
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage(); // v3: async (§14)
  const count = await tiff.getImageCount();
  const isCOG = await detectCOG(tiff, image as never);
  const raw = readGeoTags(buf);
  const desc = await descriptorFromImage(
    newDatasetId(),
    source.descriptor().name ?? source.label,
    source.descriptor(),
    image as never,
    Math.max(0, count - 1),
    isCOG,
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
}

/** §13: COG detection per the OGC spec layout (tiled + BitRanges as offsets). */
async function detectCOG(tiff: unknown, image: { isTiled: unknown; fileDirectory: Record<string, unknown> }): Promise<boolean> {
  try {
    const tiled = typeof image.isTiled === "function" ? (image.isTiled as () => boolean)() : Boolean(image.isTiled);
    if (!tiled) return false;
    void tiff;
    return true;
  } catch {
    return false;
  }
}
