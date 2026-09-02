/** Format adapter contract (§10–11). Format knowledge lives HERE and only
 *  here — it never leaks into App/components/stores (§10). Detection is
 *  layered: extension/MIME hints + magic bytes + parser validation, expressed
 *  as a confidence score. */
import type { DatasetId } from "../ids";
import type { Bounds3D } from "../bounds";
import type { DatasetMetadata } from "../metadata";
import type { DataFormat, DatasetKind, DatasetStatus } from "../types";
import type { DataSource, ByteRange } from "../source/types";
import type { SourceDescriptorLike } from "../source/types";

export interface ProbeContext {
  /** First bytes of the file (registry reads 8 KB once for all adapters). */
  header: Uint8Array;
  filename?: string;
  mime?: string;
  size?: number;
}

export interface ProbeResult {
  /** 0 = definitely not, 1 = certain. Registry picks the max ≥ threshold. */
  confidence: number;
  format?: DataFormat;
  reason?: string;
}

export interface InspectedDataset {
  name: string;
  format: DataFormat;
  kind: DatasetKind;
  metadata: DatasetMetadata;
  /** Number of chunks this dataset exposes (≥ 1). Static files: 1 (§40). */
  chunkCount: number;
}

/** Decoded point payload of one chunk — the renderer-facing shape (§38–39). */
export interface DecodedChunk {
  index: number;
  pointCount: number;
  positions: Float32Array;
  intensity?: Float32Array;
  colors?: Uint8Array;
  classification?: Uint8Array;
  bounds: Bounds3D;
  fields: DatasetMetadata["fields"];
}

export interface OpenedDataset {
  readonly id: DatasetId;
  readonly info: InspectedDataset;
  readonly source: SourceDescriptorLike;
  readonly status: DatasetStatus;
  chunkCount: number;
  /** Decode one chunk (default: the single chunk 0 for current formats). */
  readChunk(index: number, signal?: AbortSignal): Promise<DecodedChunk>;
  /** Release any adapter-held handles. Idempotent. */
  dispose(): void;
}

export interface FormatAdapter {
  readonly id: DataFormat;
  readonly label: string;
  /** Layered detection (§11): header bytes first, extension/MIME as hints. */
  probe(ctx: ProbeContext): ProbeResult;
  /** Header/metadata read — must avoid full-file reads where the format
   *  allows (§66). Rejects with VpDataError("invalid-data") on garbage. */
  inspect(source: DataSource, signal?: AbortSignal): Promise<InspectedDataset>;
  /** Open for decode. `decodeChunk` may be injected to run in a worker (§27);
   *  adapters fall back to in-place decoding when omitted. */
  open(source: DataSource, opts?: {
    signal?: AbortSignal;
    /** Perform a decode job: receives (formatId, buffer) and resolves arrays. */
    decodeChunk?: (format: DataFormat, buffer: ArrayBuffer, signal?: AbortSignal) => Promise<DecodedChunk>;
  }): Promise<OpenedDataset>;
}

export type { DataSource, ByteRange };
