/** PLY adapter (§15). Inspect reads only the ASCII header window (partial
 *  read); vertex schema comes from the header, so non-point PLYs (mesh-only,
 *  no x/y/z) are rejected rather than misread. */
import type { DataSource } from "../source/types";
import type { DataFormat } from "../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "./types";
import { readPlyHeader, parsePly } from "./parsers/ply";
import { boundsFromPositions } from "../bounds";
import type { FieldDefinition } from "../metadata";
import { makeSingleChunkAdapter, type SingleChunkSpec } from "./singleChunk";

const PLY_EXT = /\.ply$/i;
const PLY_HEADER_WINDOW = 64 * 1024;

function plyProbe(ctx: ProbeContext): ProbeResult {
  const head = new TextDecoder().decode(ctx.header.slice(0, 16));
  if (!head.startsWith("ply")) {
    return { confidence: PLY_EXT.test(ctx.filename ?? "") ? 0.15 : 0, reason: "missing ply magic" };
  }
  const hasEnd = new TextDecoder().decode(ctx.header).includes("end_header");
  let confidence = hasEnd ? 0.9 : 0.6;
  if (PLY_EXT.test(ctx.filename ?? "")) confidence = Math.min(1, confidence + 0.1);
  return { confidence, format: "ply", reason: "ply header" };
}

const spec: SingleChunkSpec = {
  id: "ply",
  label: "PLY point cloud",
  probe: plyProbe,
  async inspectInfo(source: DataSource, signal?: AbortSignal) {
    const head = await source.read({ offset: 0, length: PLY_HEADER_WINDOW }, signal);
    const header = readPlyHeader(head); // throws structured when mesh-only/invalid
    const names = header.vertexProperties.map((p) => p.name);
    const f = (name: string, semantic: FieldDefinition["semantic"], scalarType: FieldDefinition["scalarType"], components: number): FieldDefinition =>
      ({ name, semantic, scalarType, components });
    const fields: FieldDefinition[] = [f("x", "position", "float32", 3)];
    if (names.includes("intensity") || names.includes("i")) fields.push(f("intensity", "intensity", "float32", 1));
    if (names.includes("red")) fields.push(f("rgb", "color", "uint8", 3, ));
    const fmt = header.encoding === "ascii" ? "ascii"
      : header.encoding === "binary_little_endian" ? "binary_le" : "binary_be";
    return {
      sourceName: source.descriptor().name,
      sourceSizeBytes: await source.size().catch(() => undefined),
      pointCount: header.vertexCount,
      // Bounds need the body; compute cheaply from header if absent later at
      // chunk decode. Header-only bounds are not in the format.
      fields,
      createdAt: new Date().toISOString(),
      formatSpecific: {
        ply: {
          encoding: fmt,
          vertexProperties: header.vertexProperties.map((p) => `${p.name}:${p.type}`),
          vertexStride: header.vertexStride,
          otherElements: header.otherElements,
        },
      },
    };
  },
  decode(buffer) {
    const parsed = parsePly(buffer);
    return {
      pointCount: parsed.pointCount,
      positions: parsed.positions,
      intensity: parsed.intensity,
      colors: parsed.colors ?? undefined,
      bounds: boundsFromPositions(parsed.positions, parsed.pointCount),
    };
  },
};

export const plyAdapter: FormatAdapter = makeSingleChunkAdapter(spec);
export const PLY_DATA_FORMAT: DataFormat = "ply";
