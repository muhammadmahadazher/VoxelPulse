/** Streaming runtime registry (§55–57): the bridge between the app layer
 *  (which creates runtimes on COPC import) and the renderer (which drives
 *  and displays them). Engine-owned; React never sees node buffers. */
import type { CopcStreamRuntime, StreamingMetrics } from "./runtime";

const runtimes = new Map<string, CopcStreamRuntime>();

/** §25, §71: throttled aggregate metrics — React polls via
 *  useSyncExternalStore; never per-frame state updates. */
let metricsSnapshot: StreamingMetrics & { datasets: number } = {
  visibleNodes: 0, visiblePoints: 0, queued: 0, fetching: 0,
  cacheNodes: 0, cacheBytes: 0, preparedBytes: 0, bytesFetched: 0, rangeRequests: 0,
  datasets: 0,
};
const metricListeners = new Set<() => void>();

export function publishMetrics(m: StreamingMetrics): void {
  metricsSnapshot = { ...m, datasets: runtimes.size };
  for (const fn of metricListeners) fn();
}

export function streamingMetricsSnapshot(): StreamingMetrics & { datasets: number } {
  return metricsSnapshot;
}

export function subscribeStreamingMetrics(fn: () => void): () => void {
  metricListeners.add(fn);
  return () => metricListeners.delete(fn);
}

export const streamingRegistry = {
  set(id: string, rt: CopcStreamRuntime): void {
    runtimes.set(id, rt);
    // §73 dev diagnostics: expose runtimes for console probing.
    if (typeof window !== "undefined") {
      (window as unknown as { __vpStreaming?: Map<string, CopcStreamRuntime> }).__vpStreaming = runtimes;
    }
    rt.hooks = {
      ...rt.hooks,
      onMetrics: publishMetrics,
    };
  },
  get(id: string): CopcStreamRuntime | undefined {
    return runtimes.get(id);
  },
  list(): CopcStreamRuntime[] {
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
