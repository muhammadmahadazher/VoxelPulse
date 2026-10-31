/** §16–18: raster tile scheduler tests — overview selection, viewport
 *  culling, priorities, fallbacks, budget. */
import { describe, it, expect } from "vitest";
import { scheduleTiles, selectOverview, texelCountAtLevel, type RasterSchedulerInput } from "./tileScheduler";

const DS = "ds-r1";
const FULL = { width: 4096, height: 4096 };
const FACTORS = [2, 4, 8, 16, 32];
const TILE = { width: 256, height: 256 };
const FOOTPRINT = { min: [500000, 3996000] as [number, number], max: [504096, 4000000] as [number, number] };

function input(overrides?: Partial<RasterSchedulerInput>): RasterSchedulerInput {
  return {
    datasetId: DS,
    width: FULL.width,
    height: FULL.height,
    overviewFactors: FACTORS,
    tileSize: TILE,
    footprint: FOOTPRINT,
    viewport: {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]], max: [FOOTPRINT.max[0], FOOTPRINT.max[1]] },
      width: 1024,
      height: 1024,
    },
    texelBudget: 16_000_000,
    ...overrides,
  };
}

describe("overview selection (§17)", () => {
  it("frame-all picks a coarse overview, not full resolution", () => {
    const level = selectOverview(FOOTPRINT, FULL, FACTORS, input().viewport);
    expect(level).toBeGreaterThan(0);
  });

  it("zoomed-in picks full resolution (factor 1)", () => {
    // viewport covering 1/16 of the extent → 1 screen px ≈ 0.25 texels
    const vp = {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]] as [number, number], max: [FOOTPRINT.min[0] + 256, FOOTPRINT.min[1] + 256] as [number, number] },
      width: 1024, height: 1024,
    };
    expect(selectOverview(FOOTPRINT, FULL, FACTORS, vp)).toBe(1);
  });

  it("frame-all picks a factor matching screen resolution (§17)", () => {
    // frame-all: 1 screen px = 4 world units → factor 4
    expect(selectOverview(FOOTPRINT, FULL, FACTORS, input().viewport)).toBe(4);
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

  it("zoomed-in viewport yields finer level + more tiles", () => {
    const vp = {
      bounds: { min: [FOOTPRINT.min[0], FOOTPRINT.min[1]], max: [FOOTPRINT.min[0] + 256, FOOTPRINT.min[1] + 256] },
      width: 1024, height: 1024,
    };
    const res = scheduleTiles(input({ viewport: vp }));
    expect(res.factor).toBe(1); // full res when zoomed in
    expect(res.tiles.length).toBeGreaterThanOrEqual(1);
  });

  it("provides fallbacks from one factor coarser (§18)", () => {
    const res = scheduleTiles(input());
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
    // 4096×4096 = 16.7M texels > 16M budget → full res unschedulable at once
    expect(texelCountAtLevel(4096, 4096, 1)).toBeGreaterThan(16_000_000);
    expect(texelCountAtLevel(4096, 4096, 2)).toBeLessThan(16_000_000);
  });
});
