/** LAS adapter (§14). Inspect is a genuine partial read — 375 header bytes,
 *  no points (demonstrates §66 partial-read architecture). No LAZ, no EPSG
 *  inference — CRS belongs to a later phase (§69). */
import { VpDataError } from "../errors";
import type { DataSource } from "../source/types";
import type { DataFormat, FormatCapabilities } from "../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "./types";
import { LAS_HEADER_BYTES, LAS_FIELDS, parseLas, readLasHeader, lasProjectionWkt, epsgFromWkt } from "./parsers/las";
import { spatialReferenceRegistry } from "../../spatial/registry";
import { UNKNOWN_REFERENCE, type SpatialReferenceInfo } from "../../spatial/reference";
import { makeSingleChunkAdapter, type SingleChunkSpec } from "./singleChunk";

const LAS_EXT = /\.las$/i;

function lasProbe(ctx: ProbeContext): ProbeResult {
  const magic = String.fromCharCode(ctx.header[0] ?? 0, ctx.header[1] ?? 0, ctx.header[2] ?? 0, ctx.header[3] ?? 0);
  if (magic !== "LASF") {
    // Right extension, wrong content must not pass on extension alone (§57).
    return { confidence: LAS_EXT.test(ctx.filename ?? "") ? 0.15 : 0, reason: "missing LASF signature" };
  }
  let confidence = 0.9;
  if (LAS_EXT.test(ctx.filename ?? "")) confidence = 1;
  return { confidence, format: "las", reason: "LASF signature" };
}

const spec: SingleChunkSpec = {
  id: "las",
  label: "LAS point cloud",
  probe: lasProbe,
  async inspectInfo(source, signal) {
    const head = await source.read({ offset: 0, length: LAS_HEADER_BYTES }, signal);
    const header = readLasHeader(head);
    if (header.compressed) {
      throw new VpDataError("unsupported-format", "This is LAZ (compressed LAS) data, which is not supported yet.", {
        detail: "convert to uncompressed .las",
      });
    }
    // §13–14: read the LASF_Projection WKT VLR when present (partial read —
    // bounded VLR region only). GeoTIFF-key VLRs are not parsed.
    const crs = await lasCrsMetadata(source, head, header.numVlrs, signal);
    const fields = LAS_FIELDS.filter((f) =>
      f.name === "x" || f.name === "intensity" ||
      (f.name === "rgb" && (header.pointFormat === 2 || header.pointFormat === 3 || header.pointFormat === 5)) ||
      (f.name === "classification" && (header.pointFormat === 0 || header.pointFormat === 1 || header.pointFormat === 4)),
    );
    return {
      sourceName: source.descriptor().name,
      sourceSizeBytes: await source.size().catch(() => undefined),
      pointCount: header.pointCount,
      bounds: header.headerBounds ?? undefined,
      fields,
      createdAt: new Date().toISOString(),
      formatVersion: `${header.versionMajor}.${header.versionMinor}`,
      spatialReference: crs,
      formatSpecific: {
        las: {
          pointFormat: header.pointFormat,
          recordLength: header.recordLength,
          scale: header.scale,
          offset: header.offset,
          legacyCount: header.legacyCount,
          compressed: header.compressed,
        },
      },
    };
  },
  decode(buffer) {
    const parsed = parseLas(buffer);
    return {
      pointCount: parsed.pointCount,
      positions: parsed.positions,
      intensity: parsed.intensity,
      colors: parsed.colors ?? undefined,
      classification: parsed.classification ?? undefined,
    };
  },
};

export const lasAdapter: FormatAdapter = makeSingleChunkAdapter(spec);

/** §13–14, §53: resolve CRS knowledge from the WKT VLR. Only record 2112 is
 *  read; GeoTIFF-key records are documented as unsupported. No VLR → honest
 *  UNKNOWN (source "none"), never silently LOCAL (§11). */
const LAS_VLR_WINDOW = 64 * 1024;
async function lasCrsMetadata(
  source: DataSource,
  head: ArrayBuffer,
  numVlrs: number,
  signal?: AbortSignal,
): Promise<SpatialReferenceInfo> {
  const unknownInfo: SpatialReferenceInfo = {
    reference: UNKNOWN_REFERENCE, source: "none",
    detail: "no LASF_Projection WKT VLR (GeoTIFF-key VLRs are not parsed)",
  };
  if (!numVlrs) return unknownInfo;
  try {
    const dv = new DataView(head);
    const headerLen = dv.getUint16(94, true) || 227;
    const pointDataOffset = dv.getUint32(96, true);
    const regionLen = Math.max(0, Math.min(pointDataOffset - headerLen, LAS_VLR_WINDOW));
    if (regionLen === 0) return unknownInfo;
    const region = await source.read({ offset: headerLen, length: regionLen }, signal);
    const full = new Uint8Array(headerLen + regionLen);
    full.set(new Uint8Array(head), 0);
    full.set(new Uint8Array(region), headerLen);
    const wkt = lasProjectionWkt(full.buffer as ArrayBuffer);
    if (!wkt) return unknownInfo;
    const epsg = epsgFromWkt(wkt);
    if (epsg) {
      const reference = spatialReferenceRegistry.resolve(`EPSG:${epsg}`);
      return { reference, source: "embedded", detail: `LAS WKT VLR (LASF_Projection 2112) → EPSG:${epsg}` };
    }
    const reference = spatialReferenceRegistry.resolveDefinition(wkt);
    return { reference, source: "embedded", detail: "LAS WKT VLR (custom definition)" };
  } catch {
    return unknownInfo; // a broken VLR must not fail the import — stays UNKNOWN
  }
}

export const LAS_CAPABILITIES: FormatCapabilities = {
  browserImport: true,
  randomAccess: false, // header-inspect only; point decode is whole-file today (§66 debt)
  streaming: false,
  export: false,
};

export type { DataSource };
