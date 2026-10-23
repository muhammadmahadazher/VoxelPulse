import { describe, it, expect } from "vitest";
import { measurePoints } from "./measure";
import { spatialReferenceRegistry } from "./registry";
import { LOCAL_REFERENCE } from "./reference";

describe("measurePoints (§61–64)", () => {
  it("euclidean for projected CRS", () => {
    const m = measurePoints([500000, 3500000, 100], [500030, 3500040, 110],
      spatialReferenceRegistry.resolve("EPSG:32643"));
    expect(m.method).toBe("euclidean");
    expect(m.horizontal).toBeCloseTo(50, 6);
    expect(m.dz).toBeCloseTo(10, 9);
    expect(m.slopeDeg).toBeCloseTo((Math.atan2(10, 50) * 180) / Math.PI, 6);
  });

  it("geodesic for geographic CRS — 1° of latitude ≈ 111.2 km, not 1 (§62)", () => {
    const m = measurePoints([74, 31.5, 0], [74, 32.5, 0],
      spatialReferenceRegistry.resolve("EPSG:4326"));
    expect(m.method).toBe("geodesic");
    expect(m.horizontal).toBeGreaterThan(110_000);
    expect(m.horizontal).toBeLessThan(112_000);
  });

  it("geodesic equator 1° longitude ≈ 111.3 km", () => {
    const m = measurePoints([0, 0, 0], [1, 0, 0],
      spatialReferenceRegistry.resolve("EPSG:4326"));
    expect(m.horizontal).toBeGreaterThan(111_000);
    expect(m.horizontal).toBeLessThan(112_000);
  });

  it("LOCAL uses euclidean metres", () => {
    const m = measurePoints([0, 0, 0], [3, 4, 0], LOCAL_REFERENCE);
    expect(m.horizontal).toBe(5);
    expect(m.method).toBe("euclidean");
  });
});
