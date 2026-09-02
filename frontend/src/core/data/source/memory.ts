/** In-memory source (§2) — tests, generated/demo data, and already-decoded
 *  payloads. Full random access, zero I/O. */
import { newDatasetId } from "../ids";
import { cancellationError } from "../errors";
import type { DataSource, ByteRange, SourceCapabilities, SourceDescriptorLike } from "./types";
import { clampRange } from "./types";

export class MemorySource implements DataSource {
  readonly id: string;
  readonly kind = "memory" as const;
  readonly label: string;
  readonly capabilities: SourceCapabilities = {
    randomAccess: true, streaming: false, knownSize: true, persistentReference: false,
  };
  private readonly bytes: Uint8Array;

  constructor(data: ArrayBuffer | Uint8Array, label = "memory buffer") {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.label = label;
    this.id = newDatasetId();
  }

  async size(): Promise<number> {
    return this.bytes.byteLength;
  }

  async read(range?: ByteRange, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) throw cancellationError();
    const r = range ? clampRange(range, this.bytes.byteLength) : { offset: 0, length: this.bytes.byteLength };
    return this.bytes.slice(r.offset, r.offset + r.length).buffer as ArrayBuffer;
  }

  async fingerprint(): Promise<string> {
    return `memory:${this.label}:${this.bytes.byteLength}`;
  }

  descriptor(): SourceDescriptorLike {
    return { kind: "memory", name: this.label, size: this.bytes.byteLength };
  }
}
