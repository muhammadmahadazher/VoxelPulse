/** Raster streaming runtime (§13, §16, §20-21): one instance per raster
 *  dataset. Owns a GeoTIFF.fromSource handle over the VoxelPulse DataSource
 *  (every IFD/tile/overview byte flows through VoxelPulse accounting — no
 *  whole-file reads, no silent fallbacks), the tile scheduler, the
 *  decoded-tile cache under a texture budget, and progressive tile loading
 *  with cancellation. Engine-owned — React sees only metrics. */
import type { DataSource } from "../data/source/types";
import type { RasterDescriptor, SampleType } from "./model";
import { scheduleTiles, type MapViewport, type ScheduledTile } from "./tileScheduler";
import { VpGeoTIFFSource } from "./vpSource";
import { isCancelledError } from "../data/errors";
import { createLogger } from "../data/logging";
import type { RasterStyle } from "./bands";
import { DEFAULT_RASTER_STYLE } from "./bands";

const log = createLogger("raster");

export interface RasterMetrics {
  residentTiles: number;
  visibleTiles: number;
  queued: number;
  textureBytes: number;
  fetchedBytes: number;
}

export interface RasterRuntimeHooks {
  onTileReady: (tile: ScheduledTile) => void;
  onTileEvicted: (key: string) => void;
  onMetrics?: (m: RasterMetrics) => void;
}

/** One decoded tile: RAW interleaved samples (never quantized — probing and
 *  terrain sampling read this) + level metadata for display packing. */
export interface DecodedTile {
  width: number;
  height: number;
  samples: number;
  sampleType: SampleType;
  raw: Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
  tile: ScheduledTile;
}

interface TileEntry {
  tile: ScheduledTile;
  state: "unloaded" | "fetching" | "ready" | "failed";
  decoded?: DecodedTile;
  bytes: number;
  lastUsed: number;
}

interface Level {
  factor: number;
  width: number;
  height: number;
  imageIndex: number;
}

const TEXTURE_BUDGET = 256 * 1024 * 1024; // decoded texture bytes (§20)

const BYTES_PER: Record<string, number> = {
  uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, float64: 8,
};

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
  /** geotiff.js handle — source-backed (GeoTIFF.fromSource). */
  private tiff: import("geotiff").default | null = null;
  private vpSource: VpGeoTIFFSource | null = null;
  /** Real overview levels measured from the actual images. */
  private levels: Level[] = [];
  /** Display style (raw data is never restyled — packing is display-only). */
  style: RasterStyle = { ...DEFAULT_RASTER_STYLE };
  /** Bumped on setStyle — the renderer re-packs resident tiles. */
  styleEpoch = 0;

  private constructor(datasetId: string, source: DataSource, descriptor: RasterDescriptor, hooks: RasterRuntimeHooks) {
    this.datasetId = datasetId;
    this.source = source;
    this.descriptor = descriptor;
    this.hooks = hooks;
  }

  static async open(datasetId: string, source: DataSource, descriptor: RasterDescriptor, hooks: RasterRuntimeHooks): Promise<RasterStreamRuntime> {
    const rt = new RasterStreamRuntime(datasetId, source, descriptor, hooks);
    const { default: GeoTIFF } = await import("geotiff");
    rt.vpSource = new VpGeoTIFFSource(source);
    rt.tiff = await GeoTIFF.fromSource(rt.vpSource as never);
    await rt.measureLevels();
    return rt;
  }

  /** §13: real levels from the actual IFDs — factor = full.width/ov.width
   *  (measured, never assumed 2^i); imageIndex maps factor → geotiff image. */
  private async measureLevels(): Promise<void> {
    if (!this.tiff) return;
    const count = await this.tiff.getImageCount();
    const full = await this.tiff.getImage(0);
    this.levels = [{ factor: 1, width: full.getWidth(), height: full.getHeight(), imageIndex: 0 }];
    for (let i = 1; i < count; i++) {
      const ov = await this.tiff.getImage(i);
      const w = ov.getWidth(), h = ov.getHeight();
      if (w >= this.levels[0].width) continue; // not an overview
      const factor = Math.max(1, Math.round(this.levels[0].width / Math.max(1, w)));
      this.levels.push({ factor, width: w, height: h, imageIndex: i });
    }
    this.levels.sort((a, b) => a.factor - b.factor);
    if (this.descriptor.overviews.length === 0 && this.levels.length > 1) {
      // descriptor came from a header-window inspect without overview info —
      // keep the measured truth for scheduling.
      this.descriptor = {
        ...this.descriptor,
        overviews: this.levels.slice(1).map((l) => ({ factor: l.factor, width: l.width, height: l.height })),
      };
    }
  }

  get rasterDescriptor(): RasterDescriptor {
    return this.descriptor;
  }

  /** Footprint AABB in project space (affine — rotation included). */
  footprint(): { min: [number, number]; max: [number, number] } {
    const gt = this.descriptor.geotransform;
    const w = this.descriptor.width, h = this.descriptor.height;
    const corners: [number, number][] = [
      [gt.c, gt.f],
      [gt.a * w + gt.c, gt.d * w + gt.f],
      [gt.b * h + gt.c, gt.e * h + gt.f],
      [gt.a * w + gt.b * h + gt.c, gt.d * w + gt.e * h + gt.f],
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
  }

  /** Drive the scheduler from the 2D map camera (§23). */
  async update(viewport: MapViewport): Promise<RasterMetrics> {
    if (this.disposed || !this.tiff || this.levels.length === 0) return this.metrics;

    const camKey = `${viewport.bounds.min[0].toFixed(1)},${viewport.bounds.min[1].toFixed(1)},${viewport.bounds.max[0].toFixed(1)},${viewport.bounds.max[1].toFixed(1)}|${viewport.width}`;
    if (camKey === this.lastCamKey && this.inFlight.size === 0) return this.metrics;
    this.lastCamKey = camKey;

    const sched = scheduleTiles({
      datasetId: this.datasetId,
      width: this.descriptor.width,
      height: this.descriptor.height,
      geotransform: this.descriptor.geotransform,
      overviews: this.levels.map((l) => ({ factor: l.factor, width: l.width, height: l.height })),
      tileSize: this.descriptor.tileSize ?? { width: 256, height: 256 },
      viewport,
      texelBudget: 16_000_000,
    });

    for (const t of sched.tiles) {
      if (this.tiles.has(t.key)) continue;
      const entry: TileEntry = { tile: t, state: "unloaded", bytes: 0, lastUsed: performance.now() };
      this.tiles.set(t.key, entry);
      void this.loadTile(entry);
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
    this.metrics.fetchedBytes = this.vpSource?.totalBytesFetched ?? 0;
    this.hooks.onMetrics?.(this.metrics);
    this.evictIfNeeded();
    return this.metrics;
  }

  private async loadTile(entry: TileEntry): Promise<void> {
    const tile = entry.tile;
    const ctrl = new AbortController();
    this.inFlight.set(tile.key, ctrl);
    entry.state = "fetching";
    try {
      if (!this.tiff) throw new Error("no tiff handle");
      // level lookup by factor → actual image index (never log2 arithmetic)
      const level = this.levels.find((l) => l.factor === tile.factor);
      if (!level) throw new Error(`no image for factor ${tile.factor}`);
      const image = await this.tiff.getImage(level.imageIndex);
      // tile.px is ALREADY in this level's pixel units (§13: the overview
      // factor is never applied twice) — clamp defensively to real dims
      const w = image.getWidth(), h = image.getHeight();
      const [c0, r0, c1, r1] = tile.px;
      const window_: [number, number, number, number] = [
        Math.max(0, Math.min(c0, w)), Math.max(0, Math.min(r0, h)),
        Math.max(0, Math.min(c1, w)), Math.max(0, Math.min(r1, h)),
      ];
      if (window_[2] <= window_[0] || window_[3] <= window_[1]) throw new Error("empty tile window");
      // interleave:true → ONE buffer in native sample order/dtype (§26);
      // raw values stay untouched — display packing is a separate step
      const read = await image.readRasters({
        window: window_, interleave: true, signal: ctrl.signal,
      }) as unknown as { width: number; height: number; data: DecodedTile["raw"] } | DecodedTile["raw"] | DecodedTile["raw"][];
      const raw = (Array.isArray(read) ? read[0] : read) as DecodedTile["raw"];
      const width = window_[2] - window_[0];
      const height = window_[3] - window_[1];
      const samples = image.getSamplesPerPixel();
      const bytes = width * height * samples * (BYTES_PER[this.descriptor.sampleType] ?? 1);
      if (this.disposed) return;
      entry.state = "ready";
      entry.bytes = bytes;
      entry.lastUsed = performance.now();
      entry.decoded = { width, height, samples, sampleType: this.descriptor.sampleType, raw, tile };
      this.hooks.onTileReady(tile);
    } catch (e) {
      if (isCancelledError(e)) {
        entry.state = "unloaded";
      } else {
        entry.state = "failed";
        log.warn(`tile ${tile.key} failed`, e);
      }
    } finally {
      this.inFlight.delete(tile.key);
    }
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
    }
    this.metrics.textureBytes = textureBytes;
  }

  metricsReadonly(): RasterMetrics {
    return this.metrics;
  }

  /** §55 analog: ready tiles for the map renderer. */
  readyTiles(): Map<string, DecodedTile> {
    const out = new Map<string, DecodedTile>();
    for (const [id, e] of this.tiles) {
      if (e.state === "ready" && e.decoded) out.set(id, e.decoded);
    }
    return out;
  }

  /** §29: pixel probe — RAW sample values at FULL-RES pixel (col,row), or
   *  null when the containing tile is not resident (§43: never zero). The
   *  resident level's stored value is returned verbatim — no interpolation,
   *  no fabricated precision (the resident factor is reported). */
  samplePixel(col: number, row: number): { values: number[]; nodata: boolean; factor: number } | null {
    for (const [, e] of this.tiles) {
      if (e.state !== "ready" || !e.decoded) continue;
      const t = e.tile;
      const f = t.factor;
      const d = e.decoded;
      // this level's pixel containing the full-res pixel
      const oc = Math.floor(col / f);
      const orow = Math.floor(row / f);
      const lc = oc - t.px[0];
      const lr = orow - t.px[1];
      if (lc < 0 || lr < 0 || lc >= d.width || lr >= d.height) continue;
      const values: number[] = [];
      for (let s = 0; s < d.samples; s++) {
        values.push(Number(d.raw[(lr * d.width + lc) * d.samples + s]));
      }
      const nodata = this.descriptor.bands.some(
        (b) => b.nodata !== undefined && Number.isFinite(b.nodata) && values[0] === b.nodata,
      );
      return { values, nodata, factor: f };
    }
    return null;
  }

  setStyle(patch: Partial<RasterStyle>): void {
    this.style = { ...this.style, ...patch };
    this.styleEpoch++;
  }

  dispose(): void {
    this.disposed = true;
    for (const [, ctrl] of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.tiles.clear();
    void this.tiff?.close?.();
    this.tiff = null;
  }
}
