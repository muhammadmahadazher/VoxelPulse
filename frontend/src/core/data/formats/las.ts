/** LAS adapter (§14). Inspect is a genuine partial read — 375 header bytes,
 *  no points (demonstrates §66 partial-read architecture). No LAZ, no EPSG
 *  inference — CRS belongs to a later phase (§69). */
import { VpDataError } from "../errors";
import type { DataSource } from "../source/types";
import type { DataFormat, FormatCapabilities } from "../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "./types";
import { LAS_HEADER_BYTES, LAS_FIELDS, parseLas, readLasHeader } from "./parsers/las";
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

export const LAS_CAPABILITIES: FormatCapabilities = {
  browserImport: true,
  randomAccess: false, // header-inspect only; point decode is whole-file today (§66 debt)
  streaming: false,
  export: false,
};

export type { DataSource };
