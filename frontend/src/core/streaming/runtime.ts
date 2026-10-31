/** COPC streaming runtime (§31, §37–45, §93–95, §106, §138, §140): owns one
 *  hierarchical dataset's node tree, drives the scheduler with camera state,
 *  executes prioritized/deduplicated/cancellable node requests through the
 *  worker prepare pipeline, and enforces visibility-aware eviction under a
 *  memory budget. Engine-owned — React observes only throttled metrics. */
import type { DataSource } from "../data/source/types";
import { CopcHierarchy } from "./hierarchy";
import { keyId, levelSpacing, type PointCloudNode, type VoxelKey } from "./node";
import { schedule, toTraversal, type CameraState, type SchedulerOptions } from "./scheduler";
import { prepareNodeData, type PreparedNode } from "../data/workers/client";
import { isCancelledError } from "../data/errors";
import { createLogger } from "../data/logging";

const log = createLogger("streaming");

export interface StreamingMetrics {
  visibleNodes: number;
  visiblePoints: number;
  queued: number;
  fetching: number;
  cacheNodes: number;
  cacheBytes: number;
  preparedBytes: number;
  bytesFetched: number;
  rangeRequests: number;
}

export interface StreamRuntimeHooks {
  /** A prepared node is ready to render (renderer adds a Points object). */
  onNodeReady: (nodeId: string, prepared: PreparedNode) => void;
  /** An evicted node's resources must be released (renderer disposes). */
  onNodeEvicted: (nodeId: string) => void;
  /** Throttled metrics for status/diagnostics (never per-frame React). */
  onMetrics?: (m: StreamingMetrics) => void;
}

interface NodeEntry {
  node: PointCloudNode;
  state: "unloaded" | "queued" | "fetching" | "decoding" | "ready" | "evicted" | "failed";
  prepared?: PreparedNode;
  bytes: number;
  lastRendered: number;
  pinned: boolean;
  failed?: boolean;
}

/** §11–12: hierarchy-page discovery state — a page is requested once,
 *  retried with bounded backoff on failure, never re-requested per frame. */
type DiscoveryState = "unknown" | "queued" | "loading" | "loaded" | "failed";

interface DiscoveryRecord {
  state: DiscoveryState;
  attempts: number;
  nextAttemptAt: number;
}

const DEFAULT_PREPARED_BUDGET = 384 * 1024 * 1024; // prepared render bytes (§22)
const DEFAULT_BYTES_BUDGET = 256 * 1024 * 1024;    // fetched (compressed/raw) bytes cache

export class CopcStreamRuntime {
  readonly datasetId: string;
  private hierarchy: CopcHierarchy;
  private source: DataSource;
  /** Public so the registry can attach metrics forwarding after open(). */
  hooks: StreamRuntimeHooks;
  private nodes = new Map<string, NodeEntry>();
  private inFlight = new Map<string, AbortController>();
  /** §11: per-node discovery state (replaces the old re-request-every-pass). */
  private discovery = new Map<string, DiscoveryRecord>();
  private static DISCOVERY_MAX_ATTEMPTS = 3;
  private static DISCOVERY_BACKOFF_MS = 2000;
  private schedOpts: SchedulerOptions;
  private preparedBudget: number;
  private bytesBudget: number;
  private metrics: StreamingMetrics = {
    visibleNodes: 0, visiblePoints: 0, queued: 0, fetching: 0,
    cacheNodes: 0, cacheBytes: 0, preparedBytes: 0, bytesFetched: 0, rangeRequests: 0,
  };
  private rootKey: VoxelKey = { level: 0, x: 0, y: 0, z: 0 };
  private disposed = false;
  /** CRS context for the worker pipeline (§36). */
  sourceProj?: string;
  targetProj?: string;
  origin: [number, number, number] = [0, 0, 0];

  private constructor(datasetId: string, source: DataSource, hierarchy: CopcHierarchy, hooks: StreamRuntimeHooks) {
    this.datasetId = datasetId;
    this.source = source;
    this.hierarchy = hierarchy;
    this.hooks = hooks;
    this.schedOpts = { pointBudget: 1_500_000 };
    this.preparedBudget = DEFAULT_PREPARED_BUDGET;
    this.bytesBudget = DEFAULT_BYTES_BUDGET;
  }

  static async open(datasetId: string, source: DataSource, hooks: StreamRuntimeHooks): Promise<CopcStreamRuntime> {
    const hierarchy = await CopcHierarchy.open(source);
    const rt = new CopcStreamRuntime(datasetId, source, hierarchy, hooks);
    // register root
    rt.nodes.set(keyId(rt.rootKey), {
      node: {
        key: rt.rootKey, id: keyId(rt.rootKey), level: 0,
        bounds: hierarchy.rootBounds, pointCount: -1, state: "unloaded", childKeys: [],
      },
      state: "unloaded", bytes: 0, lastRendered: 0, pinned: false,
    });
    return rt;
  }

  get pointBudget(): number {
    return this.schedOpts.pointBudget;
  }

  setPointBudget(n: number): void {
    // hard ceiling guards absurd values; the floor allows diagnostic budgets
    this.schedOpts.pointBudget = Math.max(1, Math.min(n, 12_000_000));
  }

  /** Record CRS/origin context (from the project) before first update. */
  setSpatialContext(sourceProj: string | undefined, targetProj: string | undefined, origin: [number, number, number]): void {
    this.sourceProj = sourceProj;
    this.targetProj = targetProj;
    this.origin = origin;
  }

  /** Per-frame/per-interaction update. Cheap; heavy work is the scheduler
   *  traversal + request dispatch (bounded by budget, §35). */
  /** §73: diagnostic — number of update() calls (scheduler cadence check). */
  updateCount = 0;
  /** §49: bench timing — ms ticks the harness reads. */
  openStartedAt = 0;
  firstNodeReadyAt = 0;

  /** §20/§66: last-scheduler-input fingerprint — when the camera is static
   *  and no work is in flight or pending, update() skips the traversal
   *  entirely (idle CPU falls to ~zero, no allocation churn). */
  private lastCamKey = "";
  private lastVpKey = "";

  async update(camera: CameraState, viewProjMatrix: number[]): Promise<StreamingMetrics> {
    this.updateCount++;
    if (this.disposed) return this.metrics;
    const camKey = camera.position.map((v) => v.toFixed(2)).join(",") + "|" + camera.viewportHeight;
    const vpKey = viewProjMatrix.map((v) => v.toFixed(4)).join(",");
    // §11: pending hierarchy-page loads don't count as inFlight — the idle
    // check must treat a loading/queued discovery as active work, otherwise
    // newly discovered subtrees would stall until the camera moves.
    let discoveryPending = false;
    for (const [, rec] of this.discovery) {
      if (rec.state === "loading" || rec.state === "queued") { discoveryPending = true; break; }
    }
    const idle =
      camKey === this.lastCamKey &&
      vpKey === this.lastVpKey &&
      this.inFlight.size === 0 &&
      this.metrics.queued === 0 &&
      !discoveryPending;
    if (idle) return this.metrics;
    this.lastCamKey = camKey;
    this.lastVpKey = vpKey;
    // Ensure the root page is loaded before first traversal.
    await this.hierarchy.ensureLoaded(this.rootKey);
    this.ensureChildrenDiscovered(this.rootKey);

    const root = toTraversal(this.rootKey, (k) => this.resolveForScheduler(k), 0, this.schedOpts.maxDepth ?? 8);
    if (!root) return this.metrics;
    const result = schedule({
      root,
      camera,
      viewProjMatrix,
      rootSpacing: this.hierarchy.info.spacing,
      options: this.schedOpts,
    });

    // pages first (they unlock children)
    for (const key of result.pageRequests) {
      void this.loadPageFor(key);
    }

    // node requests: dedup + cancel-stale + priority is inherent in order
    for (const req of result.requests) {
      const id = keyId(req.key);
      if (this.inFlight.has(id)) continue;
      const entry = this.nodes.get(id);
      if (!entry || entry.state === "ready" || entry.state === "failed") continue;
      void this.requestNode(req.key, req.priority);
    }

    // mark rendered freshness for eviction policy (§42–44)
    const now = performance.now();
    for (const id of result.render) {
      const e = this.nodes.get(id);
      if (e) e.lastRendered = now;
    }

    this.metrics.visibleNodes = result.render.length;
    this.metrics.visiblePoints = result.renderedPoints;
    this.metrics.queued = result.requests.length;
    this.metrics.fetching = this.inFlight.size;
    this.metrics.cacheNodes = this.nodes.size;
    this.metrics.cacheBytes = [...this.nodes.values()].reduce((s, e) => s + e.bytes, 0);
    this.metrics.preparedBytes = [...this.nodes.values()].reduce((s, e) => s + (e.prepared?.positions.byteLength ?? 0), 0);
    this.hooks.onMetrics?.(this.metrics);
    this.evictIfNeeded();
    return this.metrics;
  }

  private resolveForScheduler(key: VoxelKey) {
    const entry = this.nodes.get(keyId(key));
    if (!entry) return undefined;
    // §35–37: the scheduler works in RENDER space (camera lives there) —
    // node world bounds are shifted by the render origin.
    const [ox, oy, oz] = this.origin;
    const b = entry.node.bounds;
    return {
      key: entry.node.key,
      level: entry.node.level,
      bounds: {
        min: [b.min[0] - ox, b.min[1] - oy, b.min[2] - oz] as [number, number, number],
        max: [b.max[0] - ox, b.max[1] - oy, b.max[2] - oz] as [number, number, number],
      },
      pointCount: entry.node.pointCount,
      state: entry.state,
      childKeys: entry.node.childKeys,
    };
  }

  /** Discover children of a node after its hierarchy page is loaded. */
  private ensureChildrenDiscovered(key: VoxelKey): void {
    const entry = this.nodes.get(keyId(key));
    if (!entry) return;
    // refresh facts from the hierarchy (root starts as a page marker with
    // pointCount −1; once its page loads the real count is known)
    const e = this.hierarchy.entry(key);
    if (e && e.pointCount >= 0 && entry.node.pointCount !== e.pointCount) {
      entry.node.pointCount = e.pointCount;
      entry.node.dataRange = { offset: e.offset, length: e.byteSize };
    }
    if (entry.node.childKeys.length > 0 || key.level >= (this.schedOpts.maxDepth ?? 8)) return;
    const kids = this.hierarchy.discoverChildren(key);
    entry.node.childKeys = kids;
    for (const ck of kids) {
      const id = keyId(ck);
      if (!this.nodes.has(id)) {
        const n = this.hierarchy.node(ck);
        if (n) {
          this.nodes.set(id, { node: n, state: "unloaded", bytes: 0, lastRendered: 0, pinned: false });
          // child pages: entries with pointCount −1 are pages, not data
          const e = this.hierarchy.entry(ck);
          if (e && e.pointCount === -1) {
            this.hierarchy.loadChildPage(ck).then(() => {
              this.ensureChildrenDiscovered(ck);
            }).catch(() => { /* failed page — node stays childless */ });
          }
        }
      }
    }
  }

  private async loadPageFor(key: VoxelKey): Promise<void> {
    const id = keyId(key);
    const rec = this.discovery.get(id) ?? { state: "unknown" as DiscoveryState, attempts: 0, nextAttemptAt: 0 };
    this.discovery.set(id, rec);
    if (rec.state === "loaded" || rec.state === "loading" || rec.state === "queued") return;
    if (rec.state === "failed") {
      // §12: bounded retries with backoff — no per-frame network storms
      if (rec.attempts >= CopcStreamRuntime.DISCOVERY_MAX_ATTEMPTS) return;
      if (performance.now() < rec.nextAttemptAt) return;
    }
    rec.state = "queued";
    try {
      rec.state = "loading";
      await this.hierarchy.ensureLoaded(key);
      this.ensureChildrenDiscovered(key);
      rec.state = "loaded";
    } catch (e) {
      if (isCancelledError(e)) {
        rec.state = "unknown";
      } else {
        rec.attempts++;
        rec.state = "failed";
        rec.nextAttemptAt = performance.now() + CopcStreamRuntime.DISCOVERY_BACKOFF_MS * rec.attempts;
        log.warn(`hierarchy page load failed for ${id} (attempt ${rec.attempts})`, e);
      }
    }
  }

  /** Fetch + prepare one node (§29–31, §104). Deduplicated by id; cancelled
   *  on dispose; late results after re-request are dropped by id. */
  private async requestNode(key: VoxelKey, _priority: string): Promise<void> {
    const id = keyId(key);
    const entry = this.nodes.get(id);
    if (!entry || entry.node.pointCount <= 0) return;
    const ctrl = new AbortController();
    this.inFlight.set(id, ctrl);
    entry.state = "fetching";
    try {
      const bytes = await this.hierarchy.readNodeData(key, ctrl.signal);
      if (this.disposed) return;
      entry.state = "decoding";
      this.metrics.bytesFetched += bytes.byteLength;
      this.metrics.rangeRequests++;
      // §40/§94: keep the compressed bytes (bounded cache) and hand the
      // worker its OWN copy — the transfer detaches whatever is passed, and
      // the cached bytes must survive for retries/main-thread fallback.
      const workerBytes = bytes.slice(0);
      const compressed = this.hierarchy.header.compressed;
      const prepared = await prepareNodeData(id, workerBytes, {
        pointFormat: this.hierarchy.header.pointFormat & 0x3f,
        pointRecordLength: this.hierarchy.header.pointRecordLength,
        pointCount: entry.node.pointCount,
        compressed,
        scales: (this.hierarchy.header as unknown as { scales?: [number, number, number] }).scales ?? [1, 1, 1],
        offsets: (this.hierarchy.header as unknown as { offsets?: [number, number, number] }).offsets ?? [0, 0, 0],
        sourceProj: this.sourceProj,
        targetProj: this.targetProj,
        origin: this.origin,
      });
      if (this.disposed) return;
      if ((entry.state as string) === "evicted") return; // stale — dropped (§64)
      entry.state = "ready";
      entry.prepared = prepared;
      entry.bytes = bytes.byteLength;
      entry.node.pointCount = prepared.pointCount;
      if (!this.firstNodeReadyAt) this.firstNodeReadyAt = performance.now();
      // precise world bounds from actual points (§37, §105)
      entry.node.bounds = {
        min: prepared.worldBounds.min,
        max: prepared.worldBounds.max,
      };
      this.hooks.onNodeReady(id, prepared);
    } catch (e) {
      if (isCancelledError(e)) {
        entry.state = "unloaded";
      } else {
        entry.state = "failed";
        entry.failed = true;
        log.warn(`node ${id} failed`, e);
      }
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** Visibility-aware eviction (§42–44): evict non-pinned, not-recently-
   *  rendered, ready nodes (high level first = high detail first) until
   *  under budget. Coarse fallbacks survive. */
  private evictIfNeeded(): void {
    let preparedBytes = this.metrics.preparedBytes;
    let cachedBytes = this.metrics.cacheBytes;
    if (preparedBytes <= this.preparedBudget && cachedBytes <= this.bytesBudget) return;
    const candidates = [...this.nodes.values()]
      .filter((e) => e.state === "ready" && !e.pinned && e.prepared)
      .sort((a, b) => {
        const byVis = (a.lastRendered === 0 ? 1 : 0) - (b.lastRendered === 0 ? 1 : 0);
        if (byVis !== 0) return byVis;               // never-rendered first
        if (a.lastRendered !== b.lastRendered) return a.lastRendered - b.lastRendered;
        return b.node.level - a.node.level;          // high detail first (§43)
      });
    for (const e of candidates) {
      if (preparedBytes <= this.preparedBudget && cachedBytes <= this.bytesBudget) break;
      const id = e.node.id;
      e.state = "evicted";
      preparedBytes -= e.prepared!.positions.byteLength;
      cachedBytes -= e.bytes;
      this.hooks.onNodeEvicted(id);
      e.prepared = undefined;
      e.state = "unloaded"; // re-fetchable (§93)
    }
    this.metrics.preparedBytes = preparedBytes;
    this.metrics.cacheBytes = cachedBytes;
  }

  /** §44: pin a node (visible protection / selected-point node). */
  pin(nodeId: string, pinned: boolean): void {
    const e = this.nodes.get(nodeId);
    if (e) e.pinned = pinned;
  }

  get metricsReadonly(): StreamingMetrics {
    return this.metrics;
  }

  /** §27: the point spacing of a node (root spacing halved per level). */
  nodeSpacing(nodeId: string): number {
    const e = this.nodes.get(nodeId);
    if (!e) return 0;
    return levelSpacing(this.hierarchy.info.spacing, e.node.level);
  }

  /** Render-space root bounds (world minus origin) for camera fitting. */
  rootRenderBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const b = this.hierarchy.rootBounds;
    const [ox, oy, oz] = this.origin;
    return {
      min: [b.min[0] - ox, b.min[1] - oy, b.min[2] - oz],
      max: [b.max[0] - ox, b.max[1] - oy, b.max[2] - oz],
    };
  }

  /** §55: renderer bridge — ready nodes with prepared GPU data. */
  preparedNodes(): Map<string, PreparedNode> {
    const out = new Map<string, PreparedNode>();
    for (const [id, e] of this.nodes) {
      if (e.state === "ready" && e.prepared) out.set(id, e.prepared);
    }
    return out;
  }

  /** §73: dev diagnostics — one scheduler pass with full intermediates. */
  debugTraversal(camera: CameraState, viewProjMatrix: number[]) {
    const root = toTraversal(this.rootKey, (k) => this.resolveForScheduler(k), 0, this.schedOpts.maxDepth ?? 8);
    const result = root
      ? schedule({ root, camera, viewProjMatrix, rootSpacing: this.hierarchy.info.spacing, options: this.schedOpts })
      : null;
    return {
      rootChildren: root?.children.length ?? -1,
      rootPointCount: root?.pointCount ?? -1,
      rootBounds: root?.bounds,
      result,
      info: { spacing: this.hierarchy.info.spacing, origin: this.origin },
    };
  }

  /** §138: cancel everything and release. */
  dispose(): void {
    this.disposed = true;
    for (const [, ctrl] of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.discovery.clear();
    for (const [id, e] of this.nodes) {
      if (e.prepared) this.hooks.onNodeEvicted(id);
    }
    this.nodes.clear();
  }
}
