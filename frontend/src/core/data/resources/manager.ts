/** Resource manager (§19–22): explicit runtime ownership of decoded arrays,
 *  source caches, and estimated GPU bytes. Lifecycle states are enumerable,
 *  memory use is accounted (estimates, labelled as such), and budgets drive
 *  LRU eviction. Renderer objects register here so removal is observable. */
import { newResourceId, type DatasetId, type ResourceId } from "../ids";
import { createLogger } from "../logging";

const log = createLogger("resources");

export type ResourceKind = "cpu-decoded" | "cpu-source" | "gpu-estimate";

export type ResourceState =
  | "created" | "loading" | "ready" | "evicted" | "disposed" | "error";

export interface ResourceRecord {
  id: ResourceId;
  datasetId: DatasetId | null;
  kind: ResourceKind;
  label: string;
  bytes: number;
  state: ResourceState;
  createdAt: number;
  lastUsedAt: number;
}

export interface MemoryReport {
  totalBytes: number;
  byKind: Record<ResourceKind, number>;
  byState: Record<ResourceState, number>;
  resourceCount: number;
  /** GPU numbers are estimates (§21) — labelled at the UI layer. */
  gpuEstimateBytes: number;
}

export interface ResourceBudgets {
  /** Eviction threshold for CPU (decoded + source) bytes. Default 256 MB. */
  cpuBytes: number;
}

export const DEFAULT_BUDGETS: ResourceBudgets = { cpuBytes: 256 * 1024 * 1024 };

export class ResourceManager {
  private records = new Map<ResourceId, ResourceRecord>();
  budgets: ResourceBudgets = { ...DEFAULT_BUDGETS };
  /** Monotonic logical clock — LRU order stays exact even when operations
   *  land in the same wall-clock millisecond. */
  private tick = 0;
  private now(): number {
    return ++this.tick;
  }

  register(opts: {
    datasetId?: DatasetId | null;
    kind: ResourceKind;
    label: string;
    bytes: number;
    state?: ResourceState;
  }): ResourceId {
    const id = newResourceId();
    const t = this.now();
    this.records.set(id, {
      id,
      datasetId: opts.datasetId ?? null,
      kind: opts.kind,
      label: opts.label,
      bytes: Math.max(0, opts.bytes),
      state: opts.state ?? "ready",
      createdAt: t,
      lastUsedAt: t,
    });
    this.enforceBudgets();
    return id;
  }

  get(id: ResourceId): ResourceRecord | undefined {
    const r = this.records.get(id);
    if (r) r.lastUsedAt = this.now();
    return r;
  }

  setState(id: ResourceId, state: ResourceState): void {
    const r = this.records.get(id);
    if (r) {
      r.state = state;
      r.lastUsedAt = this.now();
    }
  }

  updateBytes(id: ResourceId, bytes: number): void {
    const r = this.records.get(id);
    if (r) r.bytes = Math.max(0, bytes);
    this.enforceBudgets();
  }

  release(id: ResourceId): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state = "disposed";
    this.records.delete(id);
  }

  /** Release every resource belonging to a dataset (§20). */
  releaseDataset(datasetId: DatasetId): number {
    let n = 0;
    for (const [id, r] of this.records) {
      if (r.datasetId === datasetId) {
        this.records.delete(id);
        n++;
      }
    }
    if (n) log.info(`released ${n} resources for ${datasetId}`);
    return n;
  }

  /** LRU eviction of ready CPU resources until under budget (§22). GPU
   *  resources are never auto-evicted here — the renderer owns those. */
  private enforceBudgets(): void {
    const cpu = () =>
      [...this.records.values()]
        .filter((r) => r.kind !== "gpu-estimate" && (r.state === "ready" || r.state === "created"))
        .reduce((s, r) => s + r.bytes, 0);
    let over = cpu() - this.budgets.cpuBytes;
    if (over <= 0) return;
    const evictable = [...this.records.values()]
      .filter((r) => r.kind !== "gpu-estimate" && r.state === "ready")
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const r of evictable) {
      if (over <= 0) break;
      r.state = "evicted";
      over -= r.bytes;
      log.info(`evicted ${r.label} (${(r.bytes / 1e6).toFixed(1)} MB) under memory budget`);
    }
  }

  report(): MemoryReport {
    const byKind: Record<ResourceKind, number> = {
      "cpu-decoded": 0, "cpu-source": 0, "gpu-estimate": 0,
    };
    const byState: Record<ResourceState, number> = {
      created: 0, loading: 0, ready: 0, evicted: 0, disposed: 0, error: 0,
    };
    let total = 0;
    for (const r of this.records.values()) {
      total += r.bytes;
      byKind[r.kind] += r.bytes;
      byState[r.state] += r.bytes;
    }
    return {
      totalBytes: total,
      byKind,
      byState,
      resourceCount: this.records.size,
      gpuEstimateBytes: byKind["gpu-estimate"],
    };
  }

  /** True when the manager holds no resource for this dataset (leak checks, §61). */
  datasetResources(datasetId: DatasetId): ResourceRecord[] {
    return [...this.records.values()].filter((r) => r.datasetId === datasetId);
  }

  clear(): void {
    this.records.clear();
  }
}

/** Application-wide instance (§19 — one owner). */
export const resourceManager = new ResourceManager();
