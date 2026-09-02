/** Dataset manager (§34): central runtime owner of opened datasets — adapter
 *  selection, resource registration, reference counting, disposal. Heavy
 *  objects live HERE, never in React/Zustand state (§34); app state observes
 *  descriptors only. */
import { resourceManager } from "./resources/manager";
import { formatRegistry, type Detection } from "./formats/registry";
import { registerBuiltinAdapters } from "./formats/index";
import type { OpenedDataset, DecodedChunk } from "./formats/types";
import type { DatasetDescriptor, DataFormat } from "./types";
import type { DataSource } from "./source/types";
import { createLogger } from "./logging";

const log = createLogger("datasets");

export interface OpenedEntry {
  dataset: OpenedDataset;
  refCount: number;
}

function toDescriptor(ds: OpenedDataset): DatasetDescriptor {
  return {
    id: ds.id,
    name: ds.info.name,
    format: ds.info.format,
    kind: ds.info.kind,
    metadata: ds.info.metadata,
    source: ds.source as DatasetDescriptor["source"],
    status: ds.status,
  };
}

export class DatasetManager {
  private opened = new Map<string, OpenedEntry>();
  private ready = false;

  private ensureAdapters(): void {
    if (!this.ready) {
      registerBuiltinAdapters();
      this.ready = true;
    }
  }

  /** Probe + inspect + open a source through the registry (§50 stages). */
  async openSource(source: DataSource, opts?: {
    signal?: AbortSignal;
    /** Worker decode injection — wired to the pool by bootstrap (§27). */
    decodeChunk?: (format: DataFormat, buffer: ArrayBuffer, signal?: AbortSignal) => Promise<DecodedChunk>;
  }): Promise<{ dataset: OpenedDataset; detection: Detection }> {
    this.ensureAdapters();
    const detection = await formatRegistry.detect(source, opts?.signal);
    const dataset = await detection.adapter.open(source, {
      signal: opts?.signal,
      decodeChunk: opts?.decodeChunk,
    });
    this.opened.set(dataset.id, { dataset, refCount: 1 });
    log.info(`opened ${dataset.info.name} (${dataset.info.format}, ${dataset.info.metadata.pointCount ?? "?"} pts)`);
    return { dataset, detection };
  }

  get(id: string): OpenedDataset | undefined {
    return this.opened.get(id)?.dataset;
  }

  descriptor(id: string): DatasetDescriptor | undefined {
    const entry = this.opened.get(id);
    return entry ? toDescriptor(entry.dataset) : undefined;
  }

  list(): DatasetDescriptor[] {
    return [...this.opened.values()].map((e) => toDescriptor(e.dataset));
  }

  /** Layers referencing a dataset take refs (§82) — last release disposes. */
  addRef(id: string): void {
    const entry = this.opened.get(id);
    if (entry) entry.refCount++;
  }

  releaseRef(id: string): void {
    const entry = this.opened.get(id);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) this.dispose(id);
  }

  /** Decode a chunk through the dataset, registering CPU bytes (§19, §21). */
  async readChunk(id: string, index: number, signal?: AbortSignal): Promise<DecodedChunk> {
    const entry = this.opened.get(id);
    if (!entry) throw new Error(`dataset ${id} not open`);
    const chunk = await entry.dataset.readChunk(index, signal);
    resourceManager.register({
      datasetId: entry.dataset.id,
      kind: "cpu-decoded",
      label: `${entry.dataset.info.name} chunk ${index}`,
      bytes: chunk.positions.byteLength + (chunk.intensity?.byteLength ?? 0) +
        (chunk.colors?.byteLength ?? 0) + (chunk.classification?.byteLength ?? 0),
    });
    return chunk;
  }

  /** Dispose regardless of refs (explicit user action on the dataset). */
  dispose(id: string): void {
    const entry = this.opened.get(id);
    if (!entry) return;
    entry.dataset.dispose();
    resourceManager.releaseDataset(entry.dataset.id);
    this.opened.delete(id);
    log.info(`disposed ${entry.dataset.info.name}`);
  }

  memoryReport() {
    return resourceManager.report();
  }
}

export const datasetManager = new DatasetManager();
