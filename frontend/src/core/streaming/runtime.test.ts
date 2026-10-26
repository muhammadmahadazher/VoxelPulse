/** CP4-6 runtime integration test against the real tiny.copc fixture. */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemorySource } from "../data/source/memory";
import { Matrix4, Vector3 } from "three";
import { CopcStreamRuntime, type StreamingMetrics } from "./runtime";

const FIX = ["../../../tests/fixtures", "../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "tiny.copc")))!;

function camera(): Parameters<CopcStreamRuntime["update"]>[0] {
  return { position: [0, 0, 30], fovYRadians: Math.PI / 3, aspect: 16 / 9, viewportHeight: 1080 };
}

const IDENT = (() => {
  const proj = new Matrix4().makePerspective(-1, 1, 1, -1, 0.5, 2000);
  const view = new Matrix4()
    .lookAt(new Vector3(0, 0, 30), new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    .multiply(new Matrix4().makeTranslation(0, 0, -30));
  return [...proj.multiply(view).elements];
})();

describe("CopcStreamRuntime (tiny.copc)", () => {
  it("streams: discovers nodes, requests, prepares and exposes them", async () => {
    const bytes = readFileSync(join(FIX, "tiny.copc"));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const source = new MemorySource(ab, "tiny.copc");
    const ready: string[] = [];
    let lastMetrics: StreamingMetrics | null = null;
    const rt = await CopcStreamRuntime.open("ds-test", source, {
      onNodeReady: (id) => { ready.push(id); },
      onNodeEvicted: () => {},
    });
    // origin = dataset bounds center (as App does)
    rt.setSpatialContext(undefined, undefined, [439_104.375, 3_487_440.375, 201.125]);
    rt.setPointBudget(1_500_000);

    // several updates (scheduler cadence) + settle for async fetch/prepare
    for (let i = 0; i < 3; i++) {
      lastMetrics = await rt.update(camera(), IDENT);
    }
    await new Promise((r) => setTimeout(r, 120));
    lastMetrics = await rt.update(camera(), IDENT);
    expect(lastMetrics).not.toBeNull();
    console.log("metrics:", JSON.stringify(lastMetrics));
    expect(ready.length).toBeGreaterThan(0);
    expect(rt.preparedNodes().size).toBe(ready.length);
    // 128 points across 9 nodes
    let total = 0;
    for (const [, p] of rt.preparedNodes()) total += p.pointCount;
    expect(total).toBe(128);
    // render-space positions near origin (origin-subtracted)
    const first = [...rt.preparedNodes().values()][0];
    expect(Math.abs(first.positions[0])).toBeLessThan(20);
    rt.dispose();
  });

  it("budget clamps rendered points and eviction keeps memory bounded", async () => {
    const bytes = readFileSync(join(FIX, "tiny.copc"));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const rt = await CopcStreamRuntime.open("ds-b", new MemorySource(ab, "tiny.copc"), {
      onNodeReady: () => {},
      onNodeEvicted: () => {},
    });
    rt.setSpatialContext(undefined, undefined, [439_104.375, 3_487_440.375, 201.125]);
    rt.setPointBudget(40); // force budget clamp below 128
    for (let i = 0; i < 3; i++) {
      const m = await rt.update(camera(), IDENT);
      expect(m.visiblePoints).toBeLessThanOrEqual(40);
    }
    await new Promise((r) => setTimeout(r, 120));
    const m = await rt.update(camera(), IDENT);
    expect(m.visiblePoints).toBeLessThanOrEqual(40);
    rt.dispose();
  });
});
