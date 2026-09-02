/** Shared single-chunk adapter plumbing (§40). Current formats decode as one
 *  chunk; the chunk contract keeps the door open for multi-chunk formats
 *  without re-plumbing (NOT hierarchical LOD — §41). */
import { newDatasetId } from "../ids";
import { boundsFromPositions, type Bounds3D } from "../bounds";
import { VpDataError, cancellationError, toVpDataError } from "../errors";
import { createLogger } from "../logging";
import type { DataSource } from "../source/types";
import type { DataFormat } from "../types";
import type {
  DecodedChunk, FormatAdapter, InspectedDataset, OpenedDataset, ProbeContext, ProbeResult,
} from "./types";
import type { DatasetMetadata } from "../metadata";

const log = createLogger("formats");

export interface ParsedCloud {
  pointCount: number;
  positions: Float32Array;
  intensity?: Float32Array;
  colors?: Uint8Array;
  classification?: Uint8Array;
  bounds?: Bounds3D; // computed by the shared path when omitted
}

export interface SingleChunkSpec {
  id: DataFormat;
  label: string;
  probe(ctx: ProbeContext): ProbeResult;
  /** Header/metadata read — SHOULD be a partial read where the format allows. */
  inspectInfo(source: DataSource, signal?: AbortSignal): Promise<DatasetMetadata>;
  /** Full-buffer decode (pure parser call). Runs on main thread unless the
   *  open() caller injected a worker decodeChunk (§27). */
  decode(buffer: ArrayBuffer): ParsedCloud;
}

export function toDecodedChunk(index: number, parsed: ParsedCloud, fields: DatasetMetadata["fields"]): DecodedChunk {
  return {
    index,
    pointCount: parsed.pointCount,
    positions: parsed.positions,
    intensity: parsed.intensity,
    colors: parsed.colors,
    classification: parsed.classification,
    bounds: parsed.bounds ?? boundsFromPositions(parsed.positions, parsed.pointCount),
    fields,
  };
}

export function makeSingleChunkAdapter(spec: SingleChunkSpec): FormatAdapter {
  return {
    id: spec.id,
    label: spec.label,
    probe: (ctx) => spec.probe(ctx),

    async inspect(source, signal) {
      try {
        const metadata = await spec.inspectInfo(source, signal);
        return {
          name: source.descriptor().name ?? source.label,
          format: spec.id,
          kind: "point-cloud",
          metadata,
          chunkCount: 1,
        };
      } catch (e) {
        throw toVpDataError(e, "invalid-data", `Could not inspect ${source.label} as ${spec.id}`, {
          format: spec.id,
        });
      }
    },

    async open(source, opts) {
      const signal = opts?.signal;
      const info = await this.inspect(source, signal);
      const id = newDatasetId();
      let disposed = false;
      const decodeInjected = opts?.decodeChunk;
      return {
        id,
        info,
        source: source.descriptor(),
        status: "ready",
        chunkCount: 1,
        readChunk: async (index: number, chunkSignal?: AbortSignal) => {
          if (disposed) throw new VpDataError("invalid-data", "Dataset is disposed");
          if (index !== 0) throw new VpDataError("invalid-data", `${spec.id} has only chunk 0 (got ${index})`);
          if (chunkSignal?.aborted || signal?.aborted) throw cancellationError();
          const buffer = await source.read(undefined, chunkSignal ?? signal);
          if (decodeInjected) {
            const chunk = await decodeInjected(spec.id, buffer, chunkSignal ?? signal);
            return { ...chunk, index: 0, fields: info.metadata.fields };
          }
          return toDecodedChunk(0, spec.decode(buffer), info.metadata.fields);
        },
        dispose: () => { disposed = true; },
      };
    },
  } satisfies FormatAdapter & { inspect: FormatAdapter["inspect"] };
}

// Log wiring once per module load for dev diagnostics (§96).
log.debug("single-chunk adapter factory ready");
