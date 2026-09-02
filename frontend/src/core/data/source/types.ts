/** Typed data-source abstraction (§2–4). A source answers "where does the
 *  data come from" and exposes *capabilities* (§3) instead of forcing callers
 *  to instanceof. Live VPF1 telemetry deliberately stays outside this
 *  interface — it is temporal, not a static byte sequence (§84). */

export interface ByteRange {
  offset: number;
  length: number;
}

export type SourceKind = "local-file" | "url" | "memory" | "generated" | "stream";

export interface SourceCapabilities {
  /** Can serve arbitrary byte ranges without reading everything before it.
   *  Future COPC/COG adapters depend on this (§3). */
  randomAccess: boolean;
  /** Can push data over time (not used for static datasets in Phase 2). */
  streaming: boolean;
  /** Total size is known up front. */
  knownSize: boolean;
  /** Can be re-connected after a project reload (URLs yes, File handles no — §46). */
  persistentReference: boolean;
}

export interface DataSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly label: string;
  readonly capabilities: SourceCapabilities;

  /** Total byte size when known (HEAD / File.size / buffer length). */
  size(): Promise<number | undefined>;

  /** Read the whole source, or one byte range. Rejects with VpDataError. */
  read(range?: ByteRange, signal?: AbortSignal): Promise<ArrayBuffer>;

  /** Cheap, stable identity for re-linking/dedup hints (§46, §80). */
  fingerprint(): Promise<string>;

  /** Persistent, serializable reference for .vxp (§78). */
  descriptor(): SourceDescriptorLike;
}

/** Local import to avoid a circular type dependency on types.ts. */
export interface SourceDescriptorLike {
  kind: SourceKind;
  name?: string;
  url?: string;
  size?: number;
  lastModified?: number;
  mime?: string;
  scenario?: string;
  endpoint?: string;
}

export function clampRange(range: ByteRange, total: number): ByteRange {
  const offset = Math.max(0, Math.min(range.offset, total));
  return { offset, length: Math.max(0, Math.min(range.length, total - offset)) };
}
