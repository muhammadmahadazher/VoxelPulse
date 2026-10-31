/** geotiff.js ↔ VoxelPulse source bridge (§14, ADR-0009). Implements the
 *  geotiff.js BaseSource contract over our DataSource: every TIFF byte
 *  range flows through VoxelPulse accounting (urlSourceStats for remote,
 *  direct reads for local). Blocked-slice coalescing is handled inside
 *  geotiff.js (BlockedSource wraps this when constructed via fromSource). */
import type { DataSource } from "../data/source/types";

export interface GeoTIFFSlice {
  offset: number;
  length: number;
}

export class VpGeoTIFFSource {
  private source: DataSource;

  constructor(source: DataSource) {
    this.source = source;
  }

  async fetch(slices: GeoTIFFSlice[], signal?: AbortSignal): Promise<ArrayBuffer[]> {
    const out: ArrayBuffer[] = [];
    for (const slice of slices) {
      const r = await this.fetchSlice(slice, signal);
      out.push(r.data);
    }
    return out;
  }

  async fetchSlice(slice: GeoTIFFSlice, signal?: AbortSignal): Promise<{ offset: number; length: number; data: ArrayBuffer }> {
    const data = await this.source.read({ offset: slice.offset, length: slice.length }, signal);
    return { offset: slice.offset, length: slice.length, data: data as ArrayBuffer };
  }

  get fileSize(): number | null {
    // DataSource.size is async — geotiff.js handles null by reading the header
    return null;
  }

  async close(): Promise<void> {
    /* DataSource lifecycle owned by the dataset manager */
  }
}
