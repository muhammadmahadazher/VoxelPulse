/** Raster streaming registry (§55 analog): the bridge between the app layer
 *  (creates runtimes on GeoTIFF import) and the Map workspace renderer. */
import type { RasterStreamRuntime } from "../raster/runtime";

const runtimes = new Map<string, RasterStreamRuntime>();

export const rasterRegistry = {
  set(id: string, rt: RasterStreamRuntime): void {
    runtimes.set(id, rt);
    if (typeof window !== "undefined") {
      (window as unknown as { __vpRasters?: Map<string, RasterStreamRuntime> }).__vpRasters = runtimes;
    }
  },
  get(id: string): RasterStreamRuntime | undefined {
    return runtimes.get(id);
  },
  list(): RasterStreamRuntime[] {
    return [...runtimes.values()];
  },
  remove(id: string): void {
    const rt = runtimes.get(id);
    if (rt) rt.dispose();
    runtimes.delete(id);
  },
  clear(): void {
    for (const [, rt] of runtimes) rt.dispose();
    runtimes.clear();
  },
};
