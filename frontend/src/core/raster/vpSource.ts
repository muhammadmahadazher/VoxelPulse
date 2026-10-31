/** geotiff.js ↔ VoxelPulse source bridge (§14, ADR-0009). Implements the
 *  geotiff.js BaseSource contract over our DataSource: every TIFF byte
 *  range flows through VoxelPulse accounting (blocked-slice coalescing is
 *  handled inside geotiff.js, which wraps this in BlockedSource when
 *  constructed via fromSource). Total fetched bytes are accumulated here —
 *  the CP4B range-streaming evidence reads this counter. */
import type { DataSource } from "../data/source/types";

export interface GeoTIFFSlice {
  offset: number;
  length: number;
}

export class VpGeoTIFFSource {
  private source: DataSource;
  /** Every byte pulled through this bridge (header, IFDs, tiles). */
  totalBytesFetched = 0;
  /** Number of slice fetches (range-request count for remote sources). */
  sliceCount = 0;

  constructor(source: DataSource) {
    this.source = source;
  }

  async fetch(slices: GeoTIFFSlice[], signal?: AbortSignal): Promise<ArrayBuffer[]> {
    const out: ArrayBuffer[] = [];
    for (const slice of slices) {
      const data = await this.source.read({ offset: slice.offset, length: slice.length }, signal);
      this.totalBytesFetched += data.byteLength;
      this.sliceCount++;
      out.push(data);
    }
    return out;
  }

  async fetchSlice(slice: GeoTIFFSlice, signal?: AbortSignal): Promise<{ offset: number; length: number; data: ArrayBuffer }> {
    const data = await this.source.read({ offset: slice.offset, length: slice.length }, signal);
    this.totalBytesFetched += data.byteLength;
    this.sliceCount++;
    return { offset: slice.offset, length: slice.length, data };
  }

  get fileSize(): number | null {
    // DataSource.size is async — geotiff.js handles null by reading the header
    return null;
  }

  async close(): Promise<void> {
    /* DataSource lifecycle owned by the dataset manager */
  }
}
