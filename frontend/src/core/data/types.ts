/** Canonical dataset model (§5–6, §18). A DatasetDescriptor is the persistent,
 *  serializable description; runtime buffers live in resources, never here. */
import type { DatasetId, ChunkId } from "./ids";
import type { DatasetMetadata } from "./metadata";

export type DataFormat = "las" | "ply" | "pcd" | "xyz" | "generated" | "vpf1-stream";

export type DatasetKind = "point-cloud" | "sensor-stream";

/** Extensible categories for future formats (raster/vector/terrain/... §6). */
export type DatasetKindToken = DatasetKind | (string & {});

export type DatasetStatus = "probing" | "loading" | "ready" | "error" | "disposed";

/** Persistent source reference (§46, §78). Local files are honestly
 *  non-persistent — the browser cannot silently reopen them; .vxp stores the
 *  descriptor so the UI can offer re-linking (§47). */
export type SourceDescriptor =
  | { kind: "local-file"; name: string; size?: number; lastModified?: number; mime?: string }
  | { kind: "url"; url: string; size?: number; fingerprint?: string }
  | { kind: "memory"; name: string }
  | { kind: "generated"; name: string; scenario?: string }
  | { kind: "stream"; endpoint?: string };

export interface DatasetDescriptor {
  id: DatasetId;
  name: string;
  format: DataFormat;
  kind: DatasetKind;
  metadata: DatasetMetadata;
  source: SourceDescriptor;
  status: DatasetStatus;
}

/** Chunk identity (§40). Static files produce chunk 0 today; the contract
 *  exists so future formats (COPC/octrees) can produce thousands. This is NOT
 *  hierarchical LOD (§41) — chunking/streaming lands in the massive-data phase. */
export interface DatasetChunk {
  id: ChunkId;
  datasetId: DatasetId;
  index: number;
  bounds?: Bounds3DLike;
  pointCount?: number;
}

interface Bounds3DLike {
  min: [number, number, number];
  max: [number, number, number];
}

/** Per-format capability facts (§88) — the single source for README tables. */
export interface FormatCapabilities {
  browserImport: boolean;
  randomAccess: boolean;
  streaming: boolean;
  export: boolean;
  notes?: string;
}
