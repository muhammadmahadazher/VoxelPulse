/** §16–18: raster tile scheduler tests — overview selection from REAL level
 *  dims, viewport culling through the affine (rotation included), priorities,
 *  fallbacks, budget. */
import { describe, it, expect } from "vitest";
import {
  scheduleTiles, selectOverview, texelCountAtLevel, tileQuad, rasterFootprint,
  type RasterSchedulerInput,
} from "./tileScheduler";

const DS = "ds-r1";
const FULL = { width: 4096, height: 4096 };
// north-up 1 m texels anchored at a UTM-like origin
const GT = { a: 1, b: 0, c: 500000, d: 0, e: -1, f: 4000000 };
const OVERVIEWS = [
  { factor: 2, width: 2048, height: 2048 },
  { factor: 4, width: 1024, height: 1024 },
  { factor: 8, width: 512, height: 512 },
  { factor: 16, width: 256, height: 256 },
  { factor: 32, width: 128, height: 128 },
];
const TILE = { width: 256, height: 256 };
const FOOTPRINT = rasterFootprint(GT, FULL.width, FULL.height); // 500000..504096 × 3995904..4000000

function input(overrides?: Partial<RasterSchedulerInput>): RasterSchedulerInput {
  return {
    datasetId: DS,
    width: FULL.width,
    height: FULL.height,
    geotransform: GT,
    overviews: OVERVIEWS,
    tileSize: TILE,
    viewport: {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]], max: [FOOTPRINT.max[0], FOOTPRINT.max[1]] },
      width: 1024,
      height: 1024,
    },
    texelBudget: 16_000_000,
    ...overrides,
  } as RasterSchedulerInput;
}

describe("overview selection (§17)", () => {
  it("frame-all picks a coarse overview, not full resolution", () => {
    const level = selectOverview(FULL, GT, OVERVIEWS, input().viewport);
    expect(level).toBeGreaterThan(1);
  });

  it("zoomed-in picks full resolution (factor 1)", () => {
    const vp = {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]] as [number, number], max: [FOOTPRINT.min[0] + 256, FOOTPRINT.min[1] + 256] as [number, number] },
      width: 1024, height: 1024,
    };
    expect(selectOverview(FULL, GT, OVERVIEWS, vp)).toBe(1);
  });

  it("frame-all picks the factor matching screen resolution (§17)", () => {
    // frame-all: 1 screen px = 4 world units → factor 4
    expect(selectOverview(FULL, GT, OVERVIEWS, input().viewport)).toBe(4);
  });

  it("uses REAL overview factors, not assumed powers of two", () => {
    const odd = [
      { factor: 3, width: 1366, height: 1366 },
      { factor: 9, width: 456, height: 456 },
    ];
    // 1 screen px = 5 world units → needed 5 → largest ≤ 5 is 3
    const vp = {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]] as [number, number], max: [FOOTPRINT.min[0] + 5120, FOOTPRINT.min[1] + 5120] as [number, number] },
      width: 1024, height: 1024,
    };
    expect(selectOverview(FULL, GT, odd, vp)).toBe(3);
  });
});

describe("scheduleTiles (§16)", () => {
  it("produces only tiles intersecting the viewport (§20)", () => {
    const res = scheduleTiles(input());
    expect(res.tiles.length).toBeGreaterThan(0);
    for (const t of res.tiles) {
      expect(t.bounds.max[0]).toBeGreaterThanOrEqual(input().viewport.bounds.min[0]);
      expect(t.bounds.min[0]).toBeLessThanOrEqual(input().viewport.bounds.max[0]);
    }
  });

  it("frame-all schedules far fewer tiles than full resolution (§16-17)", () => {
    const res = scheduleTiles(input());
    const fullResTiles = Math.ceil(FULL.width / TILE.width) * Math.ceil(FULL.height / TILE.height);
    expect(fullResTiles).toBe(256); // sanity: 16×16 full-res tiles
    expect(res.tiles.length).toBeLessThan(fullResTiles);
  });

  it("zoomed-in viewport yields factor 1 + pixel windows in level units", () => {
    const vp = {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]] as [number, number], max: [FOOTPRINT.min[0] + 256, FOOTPRINT.min[1] + 256] as [number, number] },
      width: 1024, height: 1024,
    };
    const res = scheduleTiles(input({ viewport: vp }));
    expect(res.factor).toBe(1);
    // viewport sits at the raster's bottom-left → the bottom-most tile row
    const bottom = res.tiles.find((t) => t.px[3] === 4096);
    expect(bottom).toBeDefined();
    expect(bottom!.px).toEqual([0, 3840, 256, 4096]); // full-res pixels, unmultiplied
  });

  it("provides fallbacks from the next LARGER real factor (§18)", () => {
    const res = scheduleTiles(input()); // factor 4 → fallback factor 8
    expect(res.factor).toBe(4);
    expect(res.fallbacks.length).toBeGreaterThan(0);
    for (const f of res.fallbacks) {
      expect(f).toContain(`#${res.factor * 2}/`);
    }
  });

  it("prioritizes central tiles (§27-style)", () => {
    const res = scheduleTiles(input());
    const critical = res.tiles.filter((t) => t.priority === "critical");
    expect(critical.length).toBeGreaterThan(0);
  });

  it("tile keys are stable and unique (§12 analog)", () => {
    const res = scheduleTiles(input());
    const keys = new Set(res.tiles.map((t) => t.key));
    expect(keys.size).toBe(res.tiles.length);
  });

  it("texel budget bounds full-res schedulability (§52)", () => {
    expect(texelCountAtLevel(4096, 4096, 1)).toBeGreaterThan(16_000_000);
    expect(texelCountAtLevel(4096, 4096, 2)).toBeLessThan(16_000_000);
  });

  it("clamps edge tiles to the real level dims (no out-of-bounds windows)", () => {
    // 100×100 raster, tile 64 → last column/row clamped
    const fp = rasterFootprint(GT, 100, 100); // 500000..500100 × 3999900..4000000
    const small = input({
      width: 100, height: 100,
      overviews: [{ factor: 2, width: 50, height: 50 }],
      viewport: {
        bounds: { min: [fp.min[0], fp.min[1]], max: [fp.max[0], fp.max[1]] },
        width: 1024, height: 1024,
      },
    });
    const res = scheduleTiles(small);
    expect(res.tiles.length).toBeGreaterThan(0);
    for (const t of res.tiles) {
      expect(t.px[2]).toBeLessThanOrEqual(100);
      expect(t.px[3]).toBeLessThanOrEqual(100);
    }
  });
});

describe("rotated affine (§42 — never silently north-up)", () => {
  // 30° rotation, 10 m texels: columns head E-NE, rows head S-E (E<0)
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const RGT = { a: 10 * c, b: 10 * s, c: 500000, d: -10 * s, e: -10 * c, f: 4000000 };

  it("tile quads follow the rotated axes", () => {
    const { quad, bounds } = tileQuad(RGT, 1, 0, 0, 64, 64);
    expect(quad[0][0]).toBeCloseTo(500000, 3);
    expect(quad[0][1]).toBeCloseTo(4000000, 3);
    // (c1,r0) = 64·(a,d) → X east, Y south by rotation
    expect(quad[1][0]).toBeCloseTo(500000 + 64 * 10 * c, 3);
    expect(quad[1][1]).toBeCloseTo(4000000 - 64 * 10 * s, 3);
    // AABB is wider than the projected side (rotation spreads the footprint)
    expect(bounds.max[0] - bounds.min[0]).toBeGreaterThan(64 * 10 * c);
  });

  it("scheduler emits rotated quads, not axis-aligned rectangles", () => {
    const fp = rasterFootprint(RGT, 512, 512);
    const vp = {
      bounds: {
        min: [fp.min[0], fp.min[1]] as [number, number],
        max: [fp.max[0], fp.max[1]] as [number, number],
      },
      width: 1024, height: 1024,
    };
    const res = scheduleTiles(input({
      geotransform: RGT,
      width: 512, height: 512,
      overviews: [{ factor: 2, width: 256, height: 256 }],
      viewport: vp,
    }));
    expect(res.tiles.length).toBeGreaterThan(0);
    const t = res.tiles[0];
    // first quad edge must follow the rotated column direction (d ≠ 0)
    const ex = t.quad[1][0] - t.quad[0][0];
    const ey = t.quad[1][1] - t.quad[0][1];
    expect(ex).toBeGreaterThan(0);
    expect(Math.abs(ey)).toBeGreaterThan(1); // Y changes along a column → rotated
  });
});
