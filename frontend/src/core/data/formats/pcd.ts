/** PCD adapter (§16). Inspect reads only the ASCII header (partial read).
 *  ascii and binary decode today; binary_compressed is rejected upstream by
 *  the parser with a user-facing structured error (§33). */
import type { DataFormat } from "../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "./types";
import { readPcdHeader, parsePcd } from "./parsers/pcd";
import { boundsFromPositions } from "../bounds";
import { VpDataError } from "../errors";
import type { FieldDefinition } from "../metadata";
import { makeSingleChunkAdapter, type SingleChunkSpec } from "./singleChunk";

const PCD_EXT = /\.pcd$/i;
const PCD_HEADER_WINDOW = 8 * 1024;

function pcdProbe(ctx: ProbeContext): ProbeResult {
  const head = new TextDecoder().decode(ctx.header.slice(0, 256));
  const isPcd = head.startsWith("# .PCD") || /^VERSION\s/m.test(head) && /\bFIELDS\b/.test(head);
  if (!isPcd) {
    return { confidence: PCD_EXT.test(ctx.filename ?? "") ? 0.15 : 0, reason: "no PCD header" };
  }
  let confidence = 0.9;
  if (PCD_EXT.test(ctx.filename ?? "")) confidence = 1;
  return { confidence, format: "pcd", reason: "PCD header" };
}

const spec: SingleChunkSpec = {
  id: "pcd",
  label: "PCD point cloud",
  probe: pcdProbe,
  async inspectInfo(source, signal) {
    const head = await source.read({ offset: 0, length: PCD_HEADER_WINDOW }, signal);
    const header = readPcdHeader(head);
    if (header.encoding === "binary_compressed") {
      throw new VpDataError("unsupported-format", "This PCD uses binary_compressed encoding, which is not supported.", {
        detail: "re-export with DATA binary or DATA ascii",
        context: { format: "pcd", encoding: "binary_compressed" },
      });
    }
    const fields: FieldDefinition[] = [{ name: "x", semantic: "position", scalarType: "float32", components: 3 }];
    if (header.fields.includes("intensity")) {
      fields.push({ name: "intensity", semantic: "intensity", scalarType: "float32", components: 1 });
    }
    if (header.fields.includes("r")) fields.push({ name: "rgb", semantic: "color", scalarType: "uint8", components: 3 });
    return {
      sourceName: source.descriptor().name,
      sourceSizeBytes: await source.size().catch(() => undefined),
      pointCount: header.pointCount,
      fields,
      createdAt: new Date().toISOString(),
      formatSpecific: {
        pcd: {
          encoding: header.encoding,
          fields: header.fields,
          sizes: header.sizes,
          types: header.types,
          counts: header.counts,
          pointStride: header.pointStride,
        },
      },
    };
  },
  decode(buffer) {
    const parsed = parsePcd(buffer);
    return {
      pointCount: parsed.pointCount,
      positions: parsed.positions,
      intensity: parsed.intensity,
      colors: parsed.colors ?? undefined,
      bounds: boundsFromPositions(parsed.positions, parsed.pointCount),
    };
  },
};

export const pcdAdapter: FormatAdapter = makeSingleChunkAdapter(spec);
export const PCD_DATA_FORMAT: DataFormat = "pcd" satisfies DataFormat;
