import { describe, it, expect } from "vitest";
import { ResourceManager, DEFAULT_BUDGETS } from "./manager";
import { asDatasetId } from "../ids";

describe("ResourceManager", () => {
  it("registers, accounts and reports memory by kind/state", () => {
    const rm = new ResourceManager();
    const ds = asDatasetId("ds-1");
    rm.register({ datasetId: ds, kind: "cpu-decoded", label: "chunk0", bytes: 100 });
    rm.register({ datasetId: ds, kind: "cpu-source", label: "file cache", bytes: 50 });
    rm.register({ kind: "gpu-estimate", label: "gpu buffers", bytes: 200 });
    const rep = rm.report();
    expect(rep.totalBytes).toBe(350);
    expect(rep.byKind["cpu-decoded"]).toBe(100);
    expect(rep.byKind["gpu-estimate"]).toBe(200);
    expect(rep.resourceCount).toBe(3);
  });

  it("releases per-dataset and reports leftovers (leak observability, §61)", () => {
    const rm = new ResourceManager();
    const a = asDatasetId("ds-a");
    const b = asDatasetId("ds-b");
    rm.register({ datasetId: a, kind: "cpu-decoded", label: "a0", bytes: 10 });
    rm.register({ datasetId: a, kind: "cpu-decoded", label: "a1", bytes: 10 });
    rm.register({ datasetId: b, kind: "cpu-decoded", label: "b0", bytes: 10 });
    expect(rm.datasetResources(a)).toHaveLength(2);
    expect(rm.releaseDataset(a)).toBe(2);
    expect(rm.datasetResources(a)).toHaveLength(0);
    expect(rm.report().resourceCount).toBe(1);
    expect(rm.releaseDataset(a)).toBe(0); // idempotent
  });

  it("evicts LRU ready CPU resources over budget, never GPU records", async () => {
    const rm = new ResourceManager();
    rm.budgets = { cpuBytes: 450 };
    const old = rm.register({ kind: "cpu-decoded", label: "old", bytes: 200 });
    const gpu = rm.register({ kind: "gpu-estimate", label: "gpu", bytes: 5000 });
    const fresh = rm.register({ kind: "cpu-decoded", label: "fresh", bytes: 200 });
    expect(rm.report().byState.evicted).toBe(0); // 400 ≤ 450
    rm.get(old); // touch old → fresh is now the LRU record
    await new Promise((r) => setTimeout(r, 3)); // ensure a distinct lastUsedAt
    rm.register({ kind: "cpu-decoded", label: "third", bytes: 100 }); // 500 > 450 → evict fresh
    const after = rm.report();
    expect(after.byState.evicted).toBe(200);
    expect(rm.get(old)!.state).toBe("ready"); // recently used survives
    expect(rm.get(gpu)!.state).toBe("ready"); // GPU untouched by CPU budget
    expect(after.byKind["gpu-estimate"]).toBe(5000);
    void fresh;
  });

  it("lifecycle transitions are explicit", () => {
    const rm = new ResourceManager();
    const id = rm.register({ kind: "cpu-decoded", label: "r", bytes: 1, state: "loading" });
    expect(rm.get(id)!.state).toBe("loading");
    rm.setState(id, "ready");
    expect(rm.get(id)!.state).toBe("ready");
    rm.release(id);
    expect(rm.get(id)).toBeUndefined();
    expect(rm.report().resourceCount).toBe(0);
  });

  it("defaults are sane", () => {
    expect(DEFAULT_BUDGETS.cpuBytes).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });
});
