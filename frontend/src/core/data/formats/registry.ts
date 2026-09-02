/** Format registry (§12) — the single place formats are detected and chosen.
 *  Detection reads one 8 KB header for all adapters, ranks confidence, and
 *  handles ambiguity explicitly instead of silently guessing (§11). */
import { VpDataError, toVpDataError } from "../errors";
import { createLogger } from "../logging";
import type { DataSource } from "../source/types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "./types";

const HEADER_BYTES = 8 * 1024;
const DETECT_THRESHOLD = 0.5;

const log = createLogger("format-registry");

export interface Detection {
  adapter: FormatAdapter;
  probe: ProbeResult;
  candidates: Array<{ id: string; confidence: number; reason?: string }>;
}

export class FormatRegistry {
  private adapters = new Map<string, FormatAdapter>();

  register(adapter: FormatAdapter): void {
    if (this.adapters.has(adapter.id)) {
      log.warn(`adapter "${adapter.id}" re-registered — replacing previous`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): FormatAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): FormatAdapter[] {
    return [...this.adapters.values()];
  }

  /** Detect the format of a source. Reads one header window, probes every
   *  registered adapter, picks the highest confidence ≥ threshold. A tie at
   *  the top is an explicit error, not a silent coin-flip (§11). */
  async detect(source: DataSource, signal?: AbortSignal): Promise<Detection> {
    const header = await source.read({ offset: 0, length: HEADER_BYTES }, signal);
    const size = await source.size().catch(() => undefined);
    const descriptor = source.descriptor();
    const ctx: ProbeContext = {
      header: new Uint8Array(header),
      filename: descriptor.name,
      mime: descriptor.mime,
      size,
    };

    const results = this.list().map((adapter) => {
      try {
        return { adapter, probe: adapter.probe(ctx) };
      } catch (e) {
        log.warn(`probe of ${adapter.id} threw`, e);
        return { adapter, probe: { confidence: 0, reason: "probe crashed" } as ProbeResult };
      }
    });
    results.sort((a, b) => b.probe.confidence - a.probe.confidence);
    const candidates = results.map((r) => ({ id: r.adapter.id, confidence: r.probe.confidence, reason: r.probe.reason }));

    const best = results[0];
    if (!best || best.probe.confidence < DETECT_THRESHOLD) {
      throw new VpDataError("unsupported-format", "VoxelPulse couldn't identify this file format.", {
        detail: results.length
          ? results.map((r) => `${r.adapter.id}: ${r.probe.confidence.toFixed(2)} (${r.probe.reason ?? "n/a"})`).join("; ")
          : "no adapters registered",
        context: { filename: ctx.filename },
      });
    }
    const tied = results.filter((r) => r.probe.confidence === best.probe.confidence);
    if (tied.length > 1) {
      throw new VpDataError("unsupported-format", `Ambiguous format for ${ctx.filename ?? "file"}`, {
        detail: `ties: ${tied.map((t) => t.adapter.id).join(", ")} at ${best.probe.confidence.toFixed(2)}`,
        context: { filename: ctx.filename },
      });
    }
    return { adapter: best.adapter, probe: best.probe, candidates };
  }

  /** Inspect with an already-known format id (skips detection). Named
   *  `inspectAs` — chai's object inspector auto-calls `inspect()` methods. */
  async inspectAs(source: DataSource, format: string, signal?: AbortSignal) {
    const adapter = this.adapters.get(format);
    if (!adapter) throw new VpDataError("unsupported-format", `No adapter for format "${format}"`);
    return adapter.inspect(source, signal).catch((e) => {
      throw toVpDataError(e, "invalid-data", `Could not inspect ${descriptorName(source)} as ${format}`);
    });
  }
}

function descriptorName(source: DataSource): string {
  return source.descriptor().name ?? source.label;
}

/** Application-wide registry instance (adapters register in formats/index.ts). */
export const formatRegistry = new FormatRegistry();
