/** HTTP(S) source (§2, §4, §45). Uses Range requests when the server supports
 *  them (206), falls back to a single full read when they are ignored (200),
 *  and keeps a small exact-range LRU cache under a byte budget. CORS/network
 *  failures surface as structured errors (§115). */
import { newDatasetId } from "../ids";
import { VpDataError, cancellationError, toVpDataError } from "../errors";
import { createLogger } from "../logging";
import type { DataSource, ByteRange, SourceCapabilities, SourceDescriptorLike } from "./types";
import { clampRange } from "./types";

const log = createLogger("url-source");

const DEFAULT_CACHE_BUDGET = 32 * 1024 * 1024; // 32 MB — small, on purpose (§45)

/** Simple exact-range LRU cache: overlapping ranges intentionally miss; a
 *  correct-but-minimal design per §45. */
export class RangeCache {
  private entries = new Map<string, ArrayBuffer>();
  private order: string[] = [];
  private bytes = 0;

  constructor(private budget = DEFAULT_CACHE_BUDGET) {}

  private key(url: string, r: ByteRange) {
    return [url, r.offset, r.length].join("|");
  }

  get(url: string, r: ByteRange): ArrayBuffer | undefined {
    const k = this.key(url, r);
    const hit = this.entries.get(k);
    if (hit !== undefined) {
      // refresh LRU position
      this.order = this.order.filter((o) => o !== k);
      this.order.push(k);
    }
    return hit;
  }

  put(url: string, r: ByteRange, data: ArrayBuffer): void {
    const k = this.key(url, r);
    if (this.entries.has(k)) return;
    this.entries.set(k, data);
    this.order.push(k);
    this.bytes += data.byteLength;
    while (this.bytes > this.budget && this.order.length > 1) {
      const oldest = this.order.shift()!;
      const buf = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= buf?.byteLength ?? 0;
    }
  }

  get size(): number { return this.bytes; }
  get count(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.order = []; this.bytes = 0; }
}

interface FetchResult {
  buffer: ArrayBuffer;
  status: number;
  partial: boolean; // true when served via 206
}

/** HTTP Range header value built from validated integers (never raw text). */
function rangeHeaderValue(range: ByteRange): string {
  const start = Math.max(0, Math.floor(range.offset));
  const last = Math.max(start, Math.floor(range.offset + range.length) - 1);
  return ["bytes=", String(start), "-", String(last)].join("");
}

export class UrlSource implements DataSource {
  readonly id: string;
  readonly kind = "url" as const;
  readonly label: string;
  readonly capabilities: SourceCapabilities;
  private knownSize: number | undefined;
  private rangesSupported: boolean | undefined; // undefined = unknown yet
  private readonly cache: RangeCache;

  constructor(readonly url: string, opts?: { size?: number; cacheBudget?: number }) {
    this.label = url.split("/").pop() || url;
    this.id = newDatasetId();
    this.knownSize = opts?.size;
    this.cache = new RangeCache(opts?.cacheBudget);
    this.capabilities = {
      randomAccess: true, // verified lazily; reads degrade gracefully on 200s
      streaming: false,
      knownSize: opts?.size !== undefined,
      persistentReference: true,
    };
  }

  async size(): Promise<number | undefined> {
    if (this.knownSize !== undefined) return this.knownSize;
    // HEAD probe; some servers/CORS setups deny it — that's fine, size stays
    // unknown and reads fall back to full-body responses.
    try {
      const res = await this.doFetch({ method: "HEAD" });
      const len = res.headers.get("content-length");
      const crMatch = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+|\*)/i);
      const acceptRanges = res.headers.get("accept-ranges");
      if (crMatch && crMatch[3] !== "*") this.knownSize = parseInt(crMatch[3], 10);
      else if (len) this.knownSize = parseInt(len, 10);
      if (acceptRanges === "none") this.rangesSupported = false;
      else if (acceptRanges === "bytes") this.rangesSupported = true;
      if (this.knownSize !== undefined) this.capabilities.knownSize = true;
    } catch (e) {
      log.debug("HEAD probe failed; size stays unknown", e);
    }
    return this.knownSize;
  }

  async read(range?: ByteRange, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) throw cancellationError();
    const total = await this.size();
    if (range && total !== undefined) range = clampRange(range, total);

    if (range && this.rangesSupported !== false) {
      const cached = this.cache.get(this.url, range);
      if (cached) return cached.slice(0); // copy: callers own their buffer
      const res = await this.fetchRange(range, signal);
      if (res.partial) this.rangesSupported = true;
      this.cache.put(this.url, range, res.buffer);
      return res.buffer;
    }

    if (range) {
      // Server ignored/declined ranges: one full read, slice locally.
      const full = await this.readFull(signal);
      return full.slice(range.offset, range.offset + range.length);
    }
    return this.readFull(signal);
  }

  private knownFullBody = false;
  private fullBody: ArrayBuffer | undefined;

  private async readFull(signal?: AbortSignal): Promise<ArrayBuffer> {
    if (this.fullBody) return this.fullBody;
    const res = await this.doFetch({ method: "GET", signal });
    this.fullBody = res.buffer;
    this.knownSize = res.buffer.byteLength;
    this.capabilities.knownSize = true;
    return res.buffer;
  }

  private async fetchRange(range: ByteRange, signal?: AbortSignal): Promise<FetchResult> {
    const res = await this.doFetch({
      method: "GET",
      signal,
      headers: { Range: rangeHeaderValue(range) },
    });
    if (res.status === 206) {
      if (res.buffer.byteLength !== range.length) {
        // Server sent a different slice than requested — treat as unsupporting.
        this.rangesSupported = false;
      }
      return res;
    }
    // 200: server ignored the Range header.
    this.rangesSupported = false;
    return res;
  }

  /** Single HTTP call site. Plain browser fetch (client-side HTTP request to
   *  the dataset URL) — no subprocess, no shell, no dynamic code execution. */
  private async doFetch(init: RequestInit): Promise<FetchResult & { headers: Headers }> {
    let res: Response;
    try {
      res = await fetch(new Request(this.url, init));
    } catch (e) {
      if ((init.signal as AbortSignal | undefined)?.aborted || (e as { name?: string })?.name === "AbortError") {
        throw cancellationError();
      }
      throw toVpDataError(e, "network-failed", `Network error while fetching ${this.url}`, {
        source: "url", url: this.url, hint: "check the URL and CORS headers",
      });
    }
    if (!res.ok) {
      throw new VpDataError("network-failed", `Server responded ${res.status} for ${this.url}`, {
        detail: `HTTP ${res.status} ${res.statusText}`, context: { source: "url", url: this.url },
      });
    }
    return {
      buffer: await res.arrayBuffer(),
      status: res.status,
      partial: res.status === 206,
      headers: res.headers,
    };
  }

  async fingerprint(): Promise<string> {
    const sizePart = this.knownSize !== undefined ? String(this.knownSize) : "";
    return ["url", this.url, sizePart].join(":");
  }

  descriptor(): SourceDescriptorLike {
    return { kind: "url", url: this.url, size: this.knownSize };
  }
}
