/** Raster streaming runtime (§13, §16, §20-21): one instance per raster
 *  dataset. Owns the geotiff.js handle over a VoxelPulse source, the tile
 *  scheduler, the decoded-tile cache under a texture budget, and progressive
 *  tile loading with cancellation. Engine-owned — React sees only metrics. */
import type { DataSource } from "../data/source/types";
import type { RasterDescriptor } from "./model";
import { scheduleTiles, type MapViewport, type ScheduledTile } from "./tileScheduler";
import { resourceManager } from "../data/resources/manager";
import { isCancelledError } from "../data/errors";
import { createLogger } from "../data/logging";

const log = createLogger("raster");

export interface RasterMetrics {
  residentTiles: number;
  visibleTiles: number;
  queued: number;
  textureBytes: number;
  fetchedBytes: number;
}

export interface RasterRuntimeHooks {
  onTileReady: (tile: ScheduledTile, textureData: { width: number; height: number; pixels: Uint8Array | Float32Array | Int16Array | Uint16Array | Int32Array; samples: number }) => void;
  onTileEvicted: (key: string) => void;
  onMetrics?: (m: RasterMetrics) => void;
}

interface TileEntry {
  tile: ScheduledTile;
  state: "unloaded" | "fetching" | "ready" | "failed";
  bytes: number;
  lastUsed: number;
}

const TEXTURE_BUDGET = 256 * 1024 * 1024; // decoded texture bytes (§20)

export class RasterStreamRuntime {
  readonly datasetId: string;
  private source: DataSource;
  private descriptor: RasterDescriptor;
  private hooks: RasterRuntimeHooks;
  private tiles = new Map<string, TileEntry>();
  private inFlight = new Map<string, AbortController>();
  private lastCamKey = "";
  private metrics: RasterMetrics = {
    residentTiles: 0, visibleTiles: 0, queued: 0, textureBytes: 0, fetchedBytes: 0,
  };
  private disposed = false;
  /** geotiff.js handle — created lazily (needs full header parse). */
  private tiff: import("geotiff").GeoTIFF | null = null;

  private constructor(datasetId: string, source: DataSource, descriptor: RasterDescriptor, hooks: RasterRuntimeHooks) {
    this.datasetId = datasetId;
    this.source = source;
    this.descriptor = descriptor;
    this.hooks = hooks;
  }

  static async open(datasetId: string, source: DataSource, descriptor: RasterDescriptor, hooks: RasterRuntimeHooks): Promise<RasterStreamRuntime> {
    const rt = new RasterStreamRuntime(datasetId, source, descriptor, hooks);
    // geotiff.js needs the header; read it and parse
    const { fromArrayBuffer } = await import("geotiff");
    const head = await source.read({ offset: 0, length: 32768 });
    try {
      rt.tiff = await fromArrayBuffer(head);
    } catch {
      // header window didn't contain the full IFD chain — read more
      const bigger = await source.read({ offset: 0, length: Math.min(256 * 1024, descriptor.width * 4) });
      rt.tiff = await fromArrayBuffer(bigger);
    }
    return rt;
  }

  get rasterDescriptor(): RasterDescriptor {
    return this.descriptor;
  }

  /** Drive the scheduler from the 2D map camera (§23). */
  async update(viewport: MapViewport): Promise<RasterMetrics> {
    if (this.disposed) return this.metrics;
    if (!this.tiff) return this.metrics;

    const camKey = `${viewport.bounds.min[0].toFixed(1)},${viewport.bounds.min[1].toFixed(1)},${viewport.bounds.max[0].toFixed(1)},${viewport.bounds.max[1].toFixed(1)}|${viewport.width}`;
    if (camKey === this.lastCamKey && this.inFlight.size === 0) return this.metrics;
    this.lastCamKey = camKey;

    const overviewFactors = this.descriptor.overviews.map((o) => o.factor);
    const sched = scheduleTiles({
      datasetId: this.datasetId,
      width: this.descriptor.width,
      height: this.descriptor.height,
      overviewFactors,
      tileSize: this.descriptor.tileSize ?? { width: 256, height: 256 },
      footprint: this.footprint(),
      viewport,
      texelBudget: 16_000_000,
    });

    for (const t of sched.tiles) {
      if (this.tiles.has(t.key)) continue;
      const entry: TileEntry = { tile: t, state: "unloaded", bytes: 0, lastUsed: performance.now() };
      this.tiles.set(t.key, entry);
      void this.loadTile(t);
    }

    const now = performance.now();
    for (const key of sched.fallbacks) {
      const e = this.tiles.get(key);
      if (e) e.lastUsed = now;
    }

    this.metrics.visibleTiles = sched.tiles.length;
    this.metrics.queued = sched.tiles.filter((t) => {
      const e = this.tiles.get(t.key);
      return e && (e.state === "unloaded" || e.state === "fetching");
    }).length;
    this.metrics.residentTiles = this.tiles.size;
    this.metrics.textureBytes = [...this.tiles.values()].reduce((s, e) => s + e.bytes, 0);
    this.hooks.onMetrics?.(this.metrics);
    this.evictIfNeeded();
    return this.metrics;
  }

  private footprint() {
    // full-res footprint in project space: corners via geotransform — for
    // Phase 5 the project CRS == source CRS (aligned imports); reprojected
    // footprints land with §11's projected-mesh path.
    const gt = this.descriptor.geotransform;
    const corners: [number, number][] = [
      [gt.c, gt.f],
      [gt.a * this.descriptor.width + gt.c, gt.f],
      [gt.c, gt.e * this.descriptor.height + gt.f],
      [gt.a * this.descriptor.width + gt.c, gt.e * this.descriptor.height + gt.f],
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { min: [Math.min(...xs), Math.min(...ys)] as [number, number], max: [Math.max(...xs), Math.max(...ys)] as [number, number] };
  }

  private async loadTile(tile: ScheduledTile): Promise<void> {
    const key = tile.key;
    const entry = this.tiles.get(key);
    if (!entry) return;
    const ctrl = new AbortController();
    this.inFlight.set(key, ctrl);
    entry.state = "fetching";
    try {
      if (!this.tiff) throw new Error("no tiff handle");
      // geotiff.js image order: [full, ov2, ov4, ...] → index = log2(factor)
      const imageIndex = tile.factor <= 1 ? 0 : Math.round(Math.log2(tile.factor));
      const image = await this.tiff.getImage(imageIndex);
      const window_ = this.tileToWindow(tile, image);
      const read = await image.readRasters({ window: window_, signal: ctrl.signal, samples: undefined });
      const width = window_[2] - window_[0];
      const height = window_[3] - window_[1];
      const samples = read.length;
      const bytes = width * height * samples * (read[0] instanceof Float32Array ? 4 : 1);
      if (this.disposed) return;
      entry.state = "ready";
      entry.bytes = bytes;
      entry.lastUsed = performance.now();
      this.hooks.onTileReady(tile, {
        width, height,
        pixels: read[0] as unknown as Uint8Array,
        samples,
      });
    } catch (e) {
      if (isCancelledError(e)) {
        entry.state = "unloaded";
      } else {
        entry.state = "failed";
        log.warn(`tile ${key} failed`, e);
      }
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Tile (tx,ty) at its factor → pixel window in the referenced image. */
  private tileToWindow(tile: ScheduledTile, image: { getWidth(): number; getHeight(): number }): [number, number, number, number] {
    const factor = tile.factor;
    const ovW = Math.ceil(image.getWidth() / factor);
    const ovH = Math.ceil(image.getHeight() / factor);
    const gt = this.descriptor.geotransform;
    const fullMinX = gt.c;
    const fullMaxY = gt.f;
    const texelX = Math.abs(gt.a) || 1;
    const texelY = Math.abs(gt.e) || 1;
    const px0 = Math.max(0, Math.floor((tile.bounds.min[0] - fullMinX) / texelX / factor));
    const py0 = Math.max(0, Math.floor((fullMaxY - tile.bounds.max[1]) / texelY / factor));
    const px1 = Math.min(ovW, Math.ceil((tile.bounds.max[0] - fullMinX) / texelX / factor));
    const py1 = Math.min(ovH, Math.ceil((fullMaxY - tile.bounds.min[1]) / texelY / factor));
    return [px0, py0, px1, py1];
  }

  private evictIfNeeded(): void {
    let textureBytes = this.metrics.textureBytes;
    if (textureBytes <= TEXTURE_BUDGET) return;
    const candidates = [...this.tiles.values()]
      .filter((e) => e.state === "ready")
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of candidates) {
      if (textureBytes <= TEXTURE_BUDGET) break;
      textureBytes -= e.bytes;
      this.hooks.onTileEvicted(e.tile.key);
      this.tiles.delete(e.tile.key);
      this.metrics.fetchedBytes = Math.max(0, this.metrics.fetchedBytes);
    }
    this.metrics.textureBytes = textureBytes;
  }

  metricsReadonly(): RasterMetrics {
    return this.metrics;
  }

  dispose(): void {
    this.disposed = true;
    for (const [, ctrl] of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.tiles.clear();
  }
}
