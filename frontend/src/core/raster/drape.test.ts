/** CP8 drape tests: exact same-CRS affine sampling, cross-CRS vertex
 *  transform through proj4, out-of-extent and UNKNOWN-CRS honesty. */
import { describe, it, expect } from "vitest";
import { drapeVertexColors } from "./drape";
import type { TerrainMeshData } from "./terrain";
import type { RasterDescriptor } from "./model";
import { asDatasetId } from "../data/ids";
import proj4 from "proj4";
import { worldToPixel } from "./transform";

const ORIGIN: [number, number, number] = [500000, 4000000, 0];

/** 2×2-vertex terrain patch at (E 500000..500010, N 3999990..4000000). */
function miniMesh(): TerrainMeshData {
  const positions = new Float32Array([
    0, 0, 100, 10, 0, 100, 0, -10, 102, 10, -10, 102,
  ]);
  return {
    positions, indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    bounds: { min: [0, -10, 100], max: [10, 0, 102] },
    vertexCount: 4,
  };
}

function orthoDesc(crs: string, gt: { a: number; b: number; c: number; d: number; e: number; f: number }, w: number, h: number): RasterDescriptor {
  return {
    id: asDatasetId("ortho-1"), name: "ortho", width: w, height: h, bandCount: 3,
    bands: [], sampleType: "uint8",
    geotransform: gt, crs,
    overviews: [], compression: "none", cloudOptimized: false,
    source: { kind: "memory", name: "ortho" },
  };
}

/** Imagery values: r = 10·col, g = 10·row, b = 77 — deterministic. */
function orthoValues(w: number, h: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) out.push([10 * c, 10 * r, 77]);
  }
  return out;
}

function stubOrtho(desc: RasterDescriptor, values: number[][]) {
  return {
    desc,
    samplePixel: (col: number, row: number) => {
      if (col < 0 || row < 0 || col >= desc.width || row >= desc.height) return null;
      return { values: values[row * desc.width + col], nodata: false, factor: 1 };
    },
  };
}

describe("drapeVertexColors (CP8)", () => {
  it("same CRS: vertex colors come from the imagery affine exactly", () => {
    // ortho 5 m texels anchored at (499995, 4000005) — vertex (0,0) maps to
    // pixel (1, 1) exactly
    const desc = orthoDesc("EPSG:32643", { a: 5, b: 0, c: 499995, d: 0, e: -5, f: 4000005 }, 5, 5);
    const values = orthoValues(5, 5);
    const res = drapeVertexColors({
      mesh: miniMesh(), origin: ORIGIN, projectCrsId: "EPSG:32643",
      ortho: stubOrtho(desc, values),
    });
    expect(res.warns).toEqual([]);
    // vertex 0 at (E 500000, N 4000000): col (500000-499995)/5 = 1, row (4000005-4000000)/5 = 1
    expect(res.colors[0]).toBeCloseTo(values[1 * 5 + 1][0] / 255, 6);
    expect(res.colors[1]).toBeCloseTo(values[1 * 5 + 1][1] / 255, 6);
    expect(res.colors[2]).toBeCloseTo(values[1 * 5 + 1][2] / 255, 6);
  });

  it("different CRS (EPSG:32643 terrain ← EPSG:4326 imagery): proj4 per-vertex, consistent with direct transform", () => {
    // imagery anchored at the DEM's lon/lat: WGS84 gt over ~(16.0°E, 36.14°N)
    const p0 = proj4("EPSG:32643", "EPSG:4326", [500000, 4000000]);
    const gt = { a: 1e-4, b: 0, c: p0[0] - 1e-4, d: 0, e: -1e-4, f: p0[1] + 1e-4 };
    const desc = orthoDesc("EPSG:4326", gt, 5, 5);
    const values = orthoValues(5, 5);
    const res = drapeVertexColors({
      mesh: miniMesh(), origin: ORIGIN, projectCrsId: "EPSG:32643",
      ortho: stubOrtho(desc, values),
    });
    expect(res.warns).toEqual([]);
    // vertex 0: expected imagery pixel via an INDEPENDENT proj4 transform
    const [oe, on] = proj4("EPSG:32643", "EPSG:4326", [500000, 4000000]);
    const [col, row] = worldToPixel(gt, oe, on);
    const ci = Math.floor(col), ri = Math.floor(row);
    expect(res.colors[0]).toBeCloseTo(values[ri * 5 + ci][0] / 255, 6);
    expect(res.colors[2]).toBeCloseTo(values[ri * 5 + ci][2] / 255, 6);
  });

  it("out-of-extent imagery → base-gray vertices + honest warn", () => {
    const desc = orthoDesc("EPSG:32643", { a: 5, b: 0, c: 900000, d: 0, e: -5, f: 4500000 }, 5, 5);
    const res = drapeVertexColors({
      mesh: miniMesh(), origin: ORIGIN, projectCrsId: "EPSG:32643",
      ortho: stubOrtho(desc, orthoValues(5, 5)),
    });
    expect(res.warns.length).toBe(1);
    expect(res.warns[0]).toMatch(/outside the imagery extent/);
    expect(res.colors[0]).toBeCloseTo(0.42, 3);
    expect(res.colors[3 * 3 + 2]).toBeCloseTo(0.48, 3);
  });

  it("UNKNOWN imagery CRS → no drape, transformability warn", () => {
    const desc = orthoDesc("VP:UNKNOWN", { a: 5, b: 0, c: 499995, d: 0, e: -5, f: 4000005 }, 5, 5);
    const res = drapeVertexColors({
      mesh: miniMesh(), origin: ORIGIN, projectCrsId: "EPSG:32643",
      ortho: stubOrtho(desc, orthoValues(5, 5)),
    });
    expect(res.colors.length).toBe(0);
    expect(res.warns.length).toBe(1);
    expect(res.warns[0]).toMatch(/not transformable/);
  });

  it("non-resident imagery tile → base gray + warn (never fabricated data)", () => {
    const desc = orthoDesc("EPSG:32643", { a: 5, b: 0, c: 499995, d: 0, e: -5, f: 4000005 }, 5, 5);
    const res = drapeVertexColors({
      mesh: miniMesh(), origin: ORIGIN, projectCrsId: "EPSG:32643",
      ortho: { desc, samplePixel: () => null },
    });
    expect(res.warns.length).toBe(1);
    expect(res.warns[0]).toMatch(/not resident/);
    expect(res.colors[0]).toBeCloseTo(0.42, 3);
  });
});
