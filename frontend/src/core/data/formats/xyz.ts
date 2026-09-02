/** XYZ / delimited-text adapter — the reference FormatAdapter (§17, §104).
 *  Deliberately readable: future contributors copy this structure (see
 *  docs/development/format-adapters.md). Conservative: plain text that is not
 *  a recognizable coordinate table is rejected, not force-fitted (§17). */
import { newDatasetId } from "../ids";
import { boundsFromPositions, type Bounds3D } from "../bounds";
import { VpDataError, cancellationError, toVpDataError } from "../errors";
import type { DataSource } from "../source/types";
import type { DataFormat } from "../types";
import type {
  DecodedChunk, FormatAdapter, InspectedDataset, OpenedDataset, ProbeContext, ProbeResult,
} from "./types";
import { parseXyz, XYZ_FIELDS, type ParsedPoints } from "./parsers/xyz";

const TEXT_EXT = /\.(xyz|txt|pts|asc)$/i;

/** Decode text into point arrays. Overridable so the worker pool can take
 *  over decoding without touching this adapter (§27). */
export type XyzDecoder = (text: string) => ParsedPoints;

export class XyzAdapter implements FormatAdapter {
  readonly id: DataFormat = "xyz";
  readonly label = "XYZ / delimited text";

  constructor(private decode: XyzDecoder = (text) => parseXyz(text)) {}

  probe(ctx: ProbeContext): ProbeResult {
    if (looksBinary(ctx.header)) return { confidence: 0, reason: "binary content" };
    const sample = new TextDecoder().decode(ctx.header.slice(0, 4 * 1024));
    const lines = sample.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
    if (!lines.length) return { confidence: 0, reason: "empty header" };
    let coordLines = 0;
    for (const line of lines.slice(0, 50)) {
      const parts = line.trim().split(/[\s,;]+/).filter(Boolean);
      if (parts.length >= 3 && parts.slice(0, 3).every((p) => Number.isFinite(Number(p)))) coordLines++;
    }
    const ratio = coordLines / Math.min(lines.length, 50);
    if (ratio < 0.3) return { confidence: 0.1, reason: "text is not a coordinate table" };
    let confidence = 0.55 + 0.3 * ratio; // content sniff is the primary signal
    if (TEXT_EXT.test(ctx.filename ?? "")) confidence = Math.min(1, confidence + 0.1);
    return { confidence, format: "xyz", reason: `${Math.round(ratio * 100)}% coordinate lines` };
  }

  async inspect(source: DataSource, signal?: AbortSignal): Promise<InspectedDataset> {
    const parsed = await this.readAll(source, signal);
    const bounds = boundsFromPositions(parsed.positions, parsed.pointCount);
    return {
      name: source.descriptor().name ?? source.label,
      format: this.id,
      kind: "point-cloud",
      metadata: {
        sourceName: source.descriptor().name,
        sourceSizeBytes: await source.size().catch(() => undefined),
        pointCount: parsed.pointCount,
        bounds,
        fields: XYZ_FIELDS,
        createdAt: new Date().toISOString(),
        formatSpecific: { xyz: { hasIntensityColumn: parsed.hasIntensityColumn } },
      },
      chunkCount: 1,
    };
  }

  async open(source: DataSource, opts?: {
    signal?: AbortSignal;
    decodeChunk?: (format: DataFormat, buffer: ArrayBuffer, signal?: AbortSignal) => Promise<DecodedChunk>;
  }): Promise<OpenedDataset> {
    const info = await this.inspect(source, opts?.signal);
    const id = newDatasetId();
    let disposed = false;
    const decode = opts?.decodeChunk;
    return {
      id,
      info,
      source: source.descriptor(),
      status: "ready",
      chunkCount: 1,
      readChunk: async (index: number, signal?: AbortSignal) => {
        if (disposed) throw new VpDataError("invalid-data", "Dataset is disposed");
        if (index !== 0) throw new VpDataError("invalid-data", `XYZ has only chunk 0 (got ${index})`);
        if (signal?.aborted) throw cancellationError();
        const buffer = await source.read(undefined, signal);
        if (decode) {
          // Worker path: decode runs off-main-thread (§27); the worker
          // returns bounds-computed arrays.
          const chunk = await decode(this.id, buffer, signal);
          return { ...chunk, index: 0, fields: XYZ_FIELDS };
        }
        const parsed = this.decode(new TextDecoder().decode(buffer));
        return {
          index: 0,
          pointCount: parsed.pointCount,
          positions: parsed.positions,
          intensity: parsed.intensity,
          bounds: boundsFromPositions(parsed.positions, parsed.pointCount),
          fields: XYZ_FIELDS,
        };
      },
      dispose: () => { disposed = true; },
    };
  }

  /** Text formats need the whole file before any metadata is knowable —
   *  documented whole-file debt (§66). Bounded by MAX_XYZ_POINTS. */
  private async readAll(source: DataSource, signal?: AbortSignal): Promise<ParsedPoints> {
    try {
      const buffer = await source.read(undefined, signal);
      return this.decode(new TextDecoder().decode(buffer));
    } catch (e) {
      throw toVpDataError(e, "read-failed", `Could not read ${source.label}`);
    }
  }
}

/** Heuristic binary sniff: NUL bytes or >10% control chars → not text. */
export function looksBinary(header: Uint8Array): boolean {
  const n = Math.min(header.length, 4 * 1024);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = header[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) suspicious++;
  }
  return n > 0 && suspicious / n > 0.1;
}

export type { Bounds3D };
