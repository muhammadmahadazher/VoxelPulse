/** §13–14, §53, §59: LAS WKT-VLR CRS discovery + the Lahore alignment pair. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lasProjectionWkt, epsgFromWkt, parseLas } from "../data/formats/parsers/las";
import { registerBuiltinAdapters } from "../data/formats/index";
import { formatRegistry } from "../data/formats/registry";
import { MemorySource } from "../data/source/memory";
import { datasetManager } from "../data/datasetManager";
import { spatialReferenceRegistry } from "./registry";
import { transformPoint } from "./transform";
import { prepareChunk } from "./coordinates";

const FIX = ["../../../tests/fixtures", "../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "tiny-geo.las")))!;
const ab = (name: string) => {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(() => registerBuiltinAdapters());

describe("LAS CRS metadata (§13–14)", () => {
  it("extracts the WKT VLR and its EPSG authority", () => {
    const wkt = lasProjectionWkt(ab("tiny-geo.las"));
    expect(wkt).toContain("UTM zone 43N");
    expect(epsgFromWkt(wkt!)).toBe("32643");
  });

  it("adapter surfaces embedded CRS with provenance (§53)", async () => {
    const src = new MemorySource(ab("tiny-geo.las"), "tiny-geo.las");
    const { adapter } = await formatRegistry.detect(src);
    const info = await adapter.inspect(src);
    expect(info.metadata.spatialReference).toBeDefined();
    expect(info.metadata.spatialReference!.source).toBe("embedded");
    expect(info.metadata.spatialReference!.reference.id).toBe("EPSG:32643");
    expect(info.metadata.spatialReference!.reference.name).toContain("43N");
  });

  it("plain LAS without VLRs stays UNKNOWN, never LOCAL (§11)", async () => {
    const src = new MemorySource(ab("tiny.las"), "tiny.las");
    const { adapter } = await formatRegistry.detect(src);
    const info = await adapter.inspect(src);
    expect(info.metadata.spatialReference!.reference.id).toBe("VP:UNKNOWN");
    expect(info.metadata.spatialReference!.source).toBe("none");
  });
});

describe("Lahore alignment pair (§59, §39)", () => {
  it("UTM fixture and its WGS84 twin transform to the same project-space bounds", async () => {
    const projectCrs = spatialReferenceRegistry.resolve("EPSG:32643");

    // Dataset A: embedded EPSG:32643 — identity in project space.
    const lasSrc = new MemorySource(ab("tiny-geo.las"), "tiny-geo.las");
    const { dataset: lasDs } = await datasetManager.openSource(lasSrc);
    const lasChunk = await datasetManager.readChunk(lasDs.id, 0);
    const lasPrep = prepareChunk(lasChunk, {
      sourceRef: projectCrs, // embedded EPSG:32643 == project CRS → identity
      projectRef: projectCrs,
      origin: { world: [0, 0, 0] },
    });

    // Dataset B: WGS84 text — transform geographic → project CRS.
    const xyzSrc = new MemorySource(ab("lahore-4326.xyz"), "lahore-4326.xyz");
    const { dataset: xyzDs } = await datasetManager.openSource(xyzSrc);
    const xyzChunk = await datasetManager.readChunk(xyzDs.id, 0);
    const xyzPrep = prepareChunk(xyzChunk, {
      sourceRef: spatialReferenceRegistry.resolve("EPSG:4326"),
      projectRef: projectCrs,
      origin: { world: [0, 0, 0] },
    });

    // The fundamental Phase 3 integration test (§39): aligned within cm.
    const dx = Math.abs(lasPrep.worldBounds.min[0] - xyzPrep.worldBounds.min[0]);
    const dy = Math.abs(lasPrep.worldBounds.min[1] - xyzPrep.worldBounds.min[1]);
    const dxMax = Math.abs(lasPrep.worldBounds.max[0] - xyzPrep.worldBounds.max[0]);
    const dyMax = Math.abs(lasPrep.worldBounds.max[1] - xyzPrep.worldBounds.max[1]);
    expect(dx).toBeLessThan(0.02);
    expect(dy).toBeLessThan(0.02);
    expect(dxMax).toBeLessThan(0.02);
    expect(dyMax).toBeLessThan(0.02);

    datasetManager.releaseRef(lasDs.id);
    datasetManager.releaseRef(xyzDs.id);
  });

  it("a Lahore landmark anchors at documented coordinates (§32)", () => {
    // Central point of the fixture block: 74.3587 E, 31.5204 N (Lahore).
    const [e, n] = transformPoint([74.3587, 31.5204, 0],
      spatialReferenceRegistry.resolve("EPSG:4326"),
      spatialReferenceRegistry.resolve("EPSG:32643"));
    // proj4-computed anchor, cross-checked against the fixture generator:
    const raw = parseLas(ab("tiny-geo.las"));
    const cx = raw.positions[Math.floor(raw.pointCount / 2) * 3];
    const cy = raw.positions[Math.floor(raw.pointCount / 2) * 3 + 1];
    expect(Math.abs(e - cx)).toBeLessThan(2); // grid spans ±~6 m around center
    expect(Math.abs(n - cy)).toBeLessThan(2);
  });
});
