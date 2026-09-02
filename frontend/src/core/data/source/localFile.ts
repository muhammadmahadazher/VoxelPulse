/** Browser File source (§2). Random access via Blob.slice; size is exact.
 *  persistentReference is honestly false — a reload cannot silently reopen a
 *  local file; projects persist the descriptor and offer re-linking (§46–47). */
import { newDatasetId } from "../ids";
import { cancellationError, toVpDataError } from "../errors";
import type { DataSource, ByteRange, SourceCapabilities, SourceDescriptorLike } from "./types";
import { clampRange } from "./types";

export class LocalFileSource implements DataSource {
  readonly id: string;
  readonly kind = "local-file" as const;
  readonly label: string;
  readonly capabilities: SourceCapabilities = {
    randomAccess: true, streaming: false, knownSize: true, persistentReference: false,
  };
  private readonly file: File;

  constructor(file: File) {
    this.file = file;
    this.label = file.name;
    this.id = newDatasetId();
  }

  async size(): Promise<number> {
    return this.file.size;
  }

  async read(range?: ByteRange, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) throw cancellationError();
    try {
      const r = range ? clampRange(range, this.file.size) : { offset: 0, length: this.file.size };
      const blob = r.offset === 0 && r.length === this.file.size
        ? this.file
        : this.file.slice(r.offset, r.offset + r.length);
      return await blob.arrayBuffer();
    } catch (e) {
      throw toVpDataError(e, "read-failed", `Could not read ${this.file.name}`, {
        source: "local-file", file: this.file.name,
      });
    }
  }

  /** Name+size+mtime identity — cheap and stable for re-link verification;
   *  it is NOT a content hash (§46 honesty). */
  async fingerprint(): Promise<string> {
    return `local:${this.file.name}:${this.file.size}:${this.file.lastModified}`;
  }

  descriptor(): SourceDescriptorLike {
    return {
      kind: "local-file",
      name: this.file.name,
      size: this.file.size,
      lastModified: this.file.lastModified,
      mime: this.file.type || undefined,
    };
  }
}
