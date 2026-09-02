/** Renderer-facing data contract (§38–39). The renderer receives prepared
 *  resources; it never parses formats, touches the File API, issues HTTP, or
 *  mutates project state. Chunkable by construction (§40) — today's files
 *  simply produce one chunk. */
import type { Bounds3D } from "./bounds";
import type { DecodedChunk } from "./formats/types";
import type { FieldDefinition } from "./metadata";

export interface PointCloudRenderResource {
  id: string;
  datasetId: string;
  chunkIndex: number;
  pointCount: number;
  positions: Float32Array;
  colors?: Uint8Array;
  intensity?: Float32Array;
  classification?: Uint8Array;
  bounds: Bounds3D;
  fields: FieldDefinition[];
}

/** Identity conversion: a DecodedChunk IS the render resource payload. */
export function chunkToRenderResource(chunk: DecodedChunk, datasetId: string): PointCloudRenderResource {
  return {
    id: `${datasetId}#chunk${chunk.index}`,
    datasetId,
    chunkIndex: chunk.index,
    pointCount: chunk.pointCount,
    positions: chunk.positions,
    colors: chunk.colors,
    intensity: chunk.intensity,
    classification: chunk.classification,
    bounds: chunk.bounds,
    fields: chunk.fields ?? [],
  };
}
