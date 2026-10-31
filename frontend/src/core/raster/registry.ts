/** Raster streaming registry (§55 analog): the bridge between the app layer
 *  (creates runtimes on GeoTIFF import) and the Map workspace renderer.
 *  `version` bumps on every set/remove so imperative renderers can detect
 *  membership changes without React state. */
import type { RasterStreamRuntime } from "./runtime";

const runtimes = new Map<string, RasterStreamRuntime>();

export const rasterRegistry = {
  version: 0,
  set(id: string, rt: RasterStreamRuntime): void {
    runtimes.set(id, rt);
    this.version++;
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
    this.version++;
  },
  clear(): void {
    for (const [, rt] of runtimes) rt.dispose();
    runtimes.clear();
    this.version++;
  },
};
