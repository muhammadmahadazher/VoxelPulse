/** Precision tests (§81–82) — the technically critical Phase 3 guarantees:
 *  centimetre-scale geometry survives million-scale world coordinates via
 *  the render-origin system, and the tests demonstrate WHY raw Float32 world
 *  coordinates cannot. */
import { describe, it, expect } from "vitest";
import { makeRenderOrigin, worldToRender, prepareChunk, originFromBounds } from "./coordinates";
import { spatialReferenceRegistry } from "./registry";
import type { DecodedChunk } from "../data/formats/types";

/** Float32 spacing at a magnitude: 2^(floor(log2|v|) − 23). */
function f32Spacing(v: number): number {
  return 2 ** (Math.floor(Math.log2(Math.abs(v))) - 23);
}

describe("Float32 insufficiency at geospatial magnitudes (§82)", () => {
  it("loses decimetre-scale precision at Y ≈ 3.5 M — rendered directly it would smear", () => {
    const world = 3_500_000.123;
    const f32 = Math.fround(world);
    expect(Math.abs(f32 - world)).toBeGreaterThan(0.05); // > 5 cm error, by construction
    expect(f32Spacing(world)).toBe(0.25); // spacing coarser than 25 cm
  });

  it("a 1 cm separation is destroyed by raw Float32 world coordinates", () => {
    const a = 3_500_000.500, b = 3_500_000.510; // 1 cm apart
    expect(Math.fround(b) - Math.fround(a)).toBe(0); // collapsed to the same Float32
  });
});

describe("render-origin system preserves fine geometry (§81)", () => {
  const origin = makeRenderOrigin([600_000, 3_500_000, 300]);
  const A: [number, number, number] = [600_000.500, 3_500_000.500, 300.100];
  const B: [number, number, number] = [600_000.500, 3_500_000.510, 300.105]; // 1 cm apart

  it("world→render keeps centimetre separation inside Float32", () => {
    const ra = worldToRender(origin, A);
    const rb = worldToRender(origin, B);
    const fa = new Float32Array([ra[0], ra[1], ra[2]]);
    const fb = new Float32Array([rb[0], rb[1], rb[2]]);
    const dx = fb[0] - fa[0], dy = fb[1] - fa[1], dz = fb[2] - fa[2];
    const dist = Math.hypot(dx, dy, dz);
    expect(Math.abs(dist - 0.0112)).toBeLessThan(1e-3); // ≈ 1.12 cm preserved
  });

  it("measured separation is origin-independent (§101)", () => {
    const origin2 = makeRenderOrigin([100_000, 3_000_000, 0]);
    const d1 = worldToRender(origin, B), d0 = worldToRender(origin, A);
    const d3 = worldToRender(origin2, B), d2 = worldToRender(origin2, A);
    const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    expect(dist(d1, d0)).toBeCloseTo(dist(d3, d2), 9);
  });

  it("round-trips render→world within Float64 noise (picking, §66)", () => {
    const r = worldToRender(origin, A);
    // render values are Float32 on the GPU:
    const f32 = new Float32Array([r[0], r[1], r[2]]);
    const world = [
      f32[0] + origin.world[0],
      f32[1] + origin.world[1],
      f32[2] + origin.world[2],
    ];
    // Error bounded by Float32 spacing at render magnitudes (~small), not world magnitudes:
    expect(Math.abs(world[0] - A[0])).toBeLessThan(1e-3);
    expect(Math.abs(world[1] - A[1])).toBeLessThan(1e-3);
  });
});

describe("prepareChunk pipeline (§84)", () => {
  const origin = originFromBounds({ min: [599_999, 3_499_999, 0], max: [600_001, 3_500_001, 2] });

  function chunkAt(worldXY: [number, number][]): DecodedChunk {
    const positions = new Float64Array(worldXY.length * 3);
    worldXY.forEach(([x, y], i) => {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 1 + i * 0.01;
    });
    return {
      index: 0, pointCount: worldXY.length, positions,
      bounds: { min: [0, 0, 0], max: [0, 0, 0] }, fields: [],
    } as unknown as DecodedChunk;
  }

  it("transforms, rebases and produces Float32 render coords", () => {
    // Identity (local) path:
    const local = prepareChunk(chunkAt([[0, 0], [1, 1]]), {
      sourceRef: { id: "VP:LOCAL", kind: "local", name: "local", horizontalUnit: { category: "linear", symbol: "m", name: "metre" } },
      projectRef: { id: "VP:LOCAL", kind: "local", name: "local", horizontalUnit: { category: "linear", symbol: "m", name: "metre" } },
      origin: makeRenderOrigin([0, 0, 0]),
    });
    expect(local.positions).toBeInstanceOf(Float32Array);
    expect(local.positions[0]).toBe(0);
    expect(local.worldBounds.max[0]).toBe(1);

    // UTM path: source coords in EPSG:32643 metres around (600k, 3.5M).
    const utm = prepareChunk(chunkAt([[600_000.5, 3_500_000.5], [600_000.5, 3_500_000.51]]), {
      sourceRef: utmRef(), projectRef: utmRef(), origin,
    });
    expect(utm.positions).toBeInstanceOf(Float32Array);
    expect(Math.abs(utm.positions[0])).toBeLessThan(2); // origin-subtracted → small
    const dy = utm.positions[4] - utm.positions[1];
    expect(Math.abs(dy - 0.01)).toBeLessThan(1e-3); // 1 cm preserved
  });

  it("does not mutate the source chunk (§43)", () => {
    const c = chunkAt([[600_000.5, 3_500_000.5]]);
    const before = c.positions.slice();
    prepareChunk(c, { sourceRef: utmRef(), projectRef: utmRef(), origin });
    expect(c.positions).toEqual(before);
  });
});

function utmRef() {
  return spatialReferenceRegistry.resolve("EPSG:32643");
}
