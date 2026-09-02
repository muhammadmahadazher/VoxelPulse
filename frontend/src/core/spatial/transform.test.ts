/** CRS transform tests against authoritative/definitional values (§32).
 *  Round-trips supplement but never replace anchored expectations. */
import { describe, it, expect } from "vitest";
import { spatialReferenceRegistry as reg, normalizeCrsId, bundledReferences } from "./registry";
import { transformPoint, transformPositions, getTransform } from "./transform";
import { LOCAL_REFERENCE } from "./reference";

const R = (id: string) => reg.resolve(id);

describe("registry", () => {
  it("normalizes EPSG identifiers (§8)", () => {
    expect(normalizeCrsId("EPSG:32643")).toBe("EPSG:32643");
    expect(normalizeCrsId("epsg:4326")).toBe("EPSG:4326");
    expect(normalizeCrsId("4326")).toBe("EPSG:4326");
    expect(normalizeCrsId("EPSG:32643")).toBe("EPSG:32643");
  });

  it("resolves bundled codes with units and kinds", () => {
    const utm = R("32643");
    expect(utm).toMatchObject({ kind: "projected", authority: "EPSG", code: "32643", id: "EPSG:32643" });
    expect(utm.horizontalUnit.symbol).toBe("m");
    expect(R("EPSG:4326")).toMatchObject({ kind: "geographic" });
    expect(R("EPSG:4326").horizontalUnit.symbol).toBe("°");
    expect(bundledReferences().length).toBe(2 + 120); // WGS84 + Mercator + 120 UTM zones
  });

  it("generates southern UTM zones", () => {
    expect(R("32756").name).toContain("56S");
    expect(R("32601").name).toContain("1N");
  });

  it("rejects unknown codes with structured errors", () => {
    expect(() => R("4327")).toThrow(/Unknown spatial reference/);
    expect(() => R("not-a-crs")).toThrow(/Unknown spatial reference/);
  });

  it("resolves proj4 definitions and rejects malformed WKT", () => {
    const def = reg.resolveDefinition("+proj=stere +lat_0=90 +lon_0=0 +datum=WGS84 +units=m +no_defs");
    expect(def.kind).toBe("projected");
    expect(def.projString).toContain("+proj=stere");
    expect(() => reg.resolveDefinition("GIBBERISH (not) ((a projection")).toThrow(/Could not parse/);
  });

  it("caches resolved definitions identically (§31, §106)", () => {
    expect(reg.resolve("EPSG:32643")).toBe(reg.resolve("epsg:32643"));
  });
});

describe("authoritative transforms", () => {
  it("central meridian of UTM 31N maps exactly to E 500000, N 0 (definitional)", () => {
    const [e, n] = transformPoint([3, 0, 10], R("EPSG:4326"), R("EPSG:32631"));
    expect(e).toBeCloseTo(500000, 4);
    expect(n).toBeCloseTo(0, 4);
  });

  it("(0°N, 0°E) → UTM 31N ≈ E 166021.44 (published value)", () => {
    const [e, n] = transformPoint([0, 0, 0], R("EPSG:4326"), R("EPSG:32631"));
    expect(e).toBeCloseTo(166021.4431, 2);
    expect(n).toBeCloseTo(0, 4);
  });

  it("Web Mercator is definitional: lon 180° → x = 20037508.342789244", () => {
    const [x] = transformPoint([180, 0, 0], R("EPSG:4326"), R("EPSG:3857"));
    expect(x).toBeCloseTo(20037508.342789244, 3);
    const [x0, y0] = transformPoint([0, 0, 0], R("EPSG:4326"), R("EPSG:3857"));
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(0, 6);
  });

  it("UTM southern hemisphere: N_south = 10,000,000 − N_north (definitional)", () => {
    const lon = 151.2093, lat = 33.8688; // Sydney
    const [, nNorth] = transformPoint([lon, lat, 0], R("EPSG:4326"), R("EPSG:32656"));
    const [, nSouth] = transformPoint([lon, -lat, 0], R("EPSG:4326"), R("EPSG:32756"));
    expect(nNorth + nSouth).toBeCloseTo(10_000_000, 3);
  });

  it("different UTM zones both anchor at their own central meridians (43N, 44N)", () => {
    const [, n43] = transformPoint([75, 0, 0], R("EPSG:4326"), R("EPSG:32643"));
    const [, n44] = transformPoint([81, 0, 0], R("EPSG:4326"), R("EPSG:32644"));
    expect(n43).toBeCloseTo(0, 4);
    expect(n44).toBeCloseTo(0, 4);
    const [e43] = transformPoint([75, 0, 0], R("EPSG:4326"), R("EPSG:32643"));
    expect(e43).toBeCloseTo(500000, 4); // 75° = central meridian of zone 43
  });

  it("Z passes through horizontal transforms untouched (§60)", () => {
    const [, , z] = transformPoint([74.3587, 31.5204, 318.44], R("EPSG:4326"), R("EPSG:32643"));
    expect(z).toBe(318.44);
  });

  it("inverse round-trip within 1 mm equivalent for UTM (supplementary)", () => {
    const fwd = transformPoint([74.3587, 31.5204, 0], R("EPSG:4326"), R("EPSG:32643"));
    const back = transformPoint(fwd, R("EPSG:32643"), R("EPSG:4326"));
    expect(Math.abs(back[0] - 74.3587)).toBeLessThan(1e-8);
    expect(Math.abs(back[1] - 31.5204)).toBeLessThan(1e-8);
  });

  it("identity pairs skip the engine entirely", () => {
    const p: [number, number, number] = [12.5, -8.25, 1];
    expect(transformPoint(p, LOCAL_REFERENCE, LOCAL_REFERENCE)).toEqual(p);
    expect(getTransform(LOCAL_REFERENCE, LOCAL_REFERENCE)).toBeNull();
  });

  it("refuses transforms involving LOCAL/UNKNOWN targets with structured errors", () => {
    expect(() => transformPoint([1, 2, 3], R("EPSG:4326"), LOCAL_REFERENCE))
      .toThrow(/Cannot transform/);
  });
});

describe("batch transforms (§29)", () => {
  it("matches per-point results", () => {
    const positions = new Float64Array([
      74.0, 31.5, 5,
      74.5, 31.6, 7,
      75.0, 31.7, 9,
    ]);
    const batch = transformPositions(positions, 3, R("EPSG:4326"), R("EPSG:32643"));
    for (let i = 0; i < 3; i++) {
      const single = transformPoint(
        [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] as const,
        R("EPSG:4326"), R("EPSG:32643"),
      );
      expect(batch[i * 3]).toBeCloseTo(single[0], 3);
      expect(batch[i * 3 + 1]).toBeCloseTo(single[1], 3);
      expect(batch[i * 3 + 2]).toBe(single[2]);
    }
  });

  it("identity batch copies without the engine", () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const out = transformPositions(positions, 2, LOCAL_REFERENCE, LOCAL_REFERENCE);
    expect(out).not.toBe(positions);
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("honours the `into` output buffer", () => {
    const positions = new Float64Array([74, 31.5, 1]);
    const into = new Float64Array(3);
    transformPositions(positions, 1, R("EPSG:4326"), R("EPSG:32643"), { into });
    expect(into[0]).toBeGreaterThan(300_000); // plausible UTM 43N easting
    expect(into[2]).toBe(1);
  });
});
