/** App-side bridge: decoded dataset chunks → the renderer's live frame buffer
 *  architecture (§85 preserved). This is the ONLY place the two worlds meet:
 *  core/data knows nothing about FrameData; the renderer never parses files
 *  (§38). Static imports ride the same reused GPU buffer as telemetry.
 *  Note: source-precision Float64 positions are narrowed to Float32 HERE,
 *  which is acceptable only for LOCAL-scale data; geospatial datasets go
 *  through the origin-subtracting pipeline (core/spatial/coordinates.ts) —
 *  see Phase 3 §35–38. */
import type { FrameData } from "../store";
import { EMPTY_FRAME } from "../store";
import type { DecodedChunk } from "../core/data/formats/types";

export function chunkToFrame(chunk: DecodedChunk): FrameData {
  const intensity = chunk.intensity ?? new Float32Array(chunk.pointCount).fill(0.5);
  return {
    ...EMPTY_FRAME,
    n: chunk.pointCount,
    ts: Date.now(),
    positions: chunk.positions instanceof Float64Array
      ? new Float32Array(chunk.positions)
      : chunk.positions,
    intensity,
  };
}
