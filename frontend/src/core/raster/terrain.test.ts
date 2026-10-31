/** CP6 terrain tests: exact vertex heights from a synthetic elevation plane,
 *  pixel-corner seam sharing between neighboring tiles, nodata holes (never
 *  zero-filled), origin-relative positions. */
import { describe, it, expect } from "vitest";
import { buildTerrainTile, type TerrainBuildInput } from "./terrain";
import type { ScheduledTile } from "./tileScheduler";

const GT = { a: 1, b: 0, c: 500000, d: 0, e: -1, f: 4000000 };
const ORIGIN: [number, number, number] = [500000, 4000000, 0];

function tile(px: [number, number, number, number], factor = 1): ScheduledTile {
  return {
    key: `t#${factor}/${px[0]}/${px[1]}`,
    factor, tileX: px[0], tileY: px[1],
    px,
    quad: [[0, 0], [0, 0], [0, 0], [0, 0]],
    bounds: { min: [0, 0], max: [0, 0] },
    priority: "normal",
  };
}

/** Elevation plane: z = 100 + 0.5·col + 0.25·row (full-res metres). */
function planeRaw(w: number, h: number, colOffset = 0, rowOffset = 0): Float32Array {
  const raw = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      raw[r * w + c] = 100 + 0.5 * (colOffset + c) + 0.25 * (rowOffset + r);
    }
  }
  return raw;
}

function input(over?: Partial<TerrainBuildInput>): TerrainBuildInput {
  return {
    decoded: { width: 32, bufWidth: 32, height: 32, samples: 1, raw: planeRaw(32, 32) },
    tile: tile([0, 0, 32, 32]),
    gt: GT,
    origin: ORIGIN,
    ...over,
  };
}

describe("buildTerrainTile (CP6)", () => {
  it("synthetic elevation plane → exact expected vertex heights", () => {
    const m = buildTerrainTile(input())!;
    // vertex (col 10, row 0): corner world E 500010, N 4000000; height 105
    const nx = Math.round(Math.sqrt(m.vertexCount)); // square grid, no step clamping
    const ix = 10, iy = 0;
    const i = (iy * nx + ix) * 3;
    expect(m.positions[i]).toBeCloseTo(10, 5);      // E − origin
    expect(m.positions[i + 1]).toBeCloseTo(0, 5);   // N − origin
    expect(m.positions[i + 2]).toBeCloseTo(105, 5); // 100 + 0.5·10
  });

  it("rows descend in N (e < 0) and heights follow the plane", () => {
    const m = buildTerrainTile(input())!;
    const nx = Math.round(Math.sqrt(m.vertexCount));
    const ix = 0, iy = 5;
    const i = (iy * nx + ix) * 3;
    expect(m.positions[i + 1]).toBeCloseTo(-5, 5);   // N decreases with row
    expect(m.positions[i + 2]).toBeCloseTo(100 + 0.25 * 5, 5);
  });

  it("neighboring tiles share the exact corner sample (no seam)", () => {
    // decoded windows include the +1 seam column (as runtime.loadTile does);
    // both tiles build a 17×17 corner grid for a [0,16) pixel window
    const left = buildTerrainTile(input({
      decoded: { width: 17, bufWidth: 17, height: 17, samples: 1, raw: planeRaw(17, 17) },
      tile: tile([0, 0, 16, 16]),
    }))!;
    const right = buildTerrainTile(input({
      decoded: { width: 17, bufWidth: 17, height: 17, samples: 1, raw: planeRaw(17, 17, 16, 0) },
      tile: tile([16, 0, 32, 16]),
    }))!;
    expect(left.vertexCount).toBe(17 * 17);
    expect(right.vertexCount).toBe(17 * 17);
    const nx = 17;
    // left's LAST column (corner 16) vs right's FIRST column (corner 16),
    // both in the top row: identical world position AND height (both sample
    // full-res pixel 16)
    const lIdx = (0 * nx + (nx - 1)) * 3;
    const rIdx = (0 * nx + 0) * 3;
    expect(left.positions[lIdx]).toBeCloseTo(right.positions[rIdx], 4);
    expect(left.positions[lIdx + 2]).toBeCloseTo(right.positions[rIdx + 2], 4);
    // and the corner world position is the true plane value at col 16
    expect(right.positions[rIdx]).toBeCloseTo(16, 5);
    expect(right.positions[rIdx + 2]).toBeCloseTo(100 + 0.5 * 16, 5);
  });

  it("nodata becomes a hole — triangles skipped, never zero-filled", () => {
    const raw = planeRaw(32, 32);
    raw[5 * 32 + 5] = -9999;
    raw[5 * 32 + 6] = -9999;
    raw[6 * 32 + 5] = -9999;
    raw[6 * 32 + 6] = -9999;
    const m = buildTerrainTile(input({ decoded: { width: 32, bufWidth: 32, height: 32, samples: 1, raw }, nodata: -9999 }))!;
    // no triangle may reference the nodata corner vertices
    const nx = Math.round(Math.sqrt(m.vertexCount));
    const bad = new Set([5 * nx + 5, 5 * nx + 6, 6 * nx + 5, 6 * nx + 6]);
    for (let k = 0; k < m.indices.length; k++) {
      expect(bad.has(m.indices[k])).toBe(false);
    }
    // mesh still has geometry elsewhere
    expect(m.indices.length).toBeGreaterThan(0);
  });

  it("bounds reflect valid vertices only and positions are origin-relative", () => {
    const m = buildTerrainTile(input())!;
    expect(m.bounds.min[0]).toBeCloseTo(0, 4);
    expect(m.bounds.max[0]).toBeCloseTo(32, 4);
    expect(m.bounds.min[2]).toBeCloseTo(100, 4);
    expect(m.bounds.max[2]).toBeCloseTo(100 + 0.5 * 32 + 0.25 * 32 - 0.75, 3); // last sampled corner (32 clamps to 31)
  });

  it("empty pixel window returns null (degenerate guard)", () => {
    expect(buildTerrainTile(input({ tile: tile([5, 5, 5, 5]) }))).toBeNull();
  });
});
