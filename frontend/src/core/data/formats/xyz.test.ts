import { describe, it, expect } from "vitest";
import { parseXyz } from "./parsers/xyz";
import { XyzAdapter, looksBinary } from "./xyz";
import { FormatRegistry } from "./registry";
import { MemorySource } from "../source/memory";
import { VpDataError } from "../errors";
import { boundsEquals } from "../bounds";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseXyz", () => {
  it("parses x y z [intensity] lines with mixed delimiters", () => {
    const text = "# comment\n0 1 2,0.25\n3;4 5\n6 7 8\n\n9 10 11 1.5";
    const r = parseXyz(text);
    expect(r.pointCount).toBe(4);
    expect(r.positions[0]).toBe(0);
    expect(r.positions[2]).toBe(2);
    expect(r.positions[3]).toBe(3); // second point, semicolon-delimited
    expect(r.intensity[0]).toBeCloseTo(0.25);
    expect(r.intensity[1]).toBe(0.5); // default
    expect(r.intensity[3]).toBe(1); // clamped from 1.5
    expect(r.hasIntensityColumn).toBe(true);
  });

  it("computes nothing here but preserves order for bounds", () => {
    const r = parseXyz("1 2 3\n-1 -2 -3");
    expect(r.positions).toEqual(new Float32Array([1, 2, 3, -1, -2, -3]));
  });

  it("rejects empty and non-coordinate text with structured errors", () => {
    expect(() => parseXyz("")).toThrow(VpDataError);
    try {
      parseXyz("   \n\n# only a comment");
      expect.unreachable();
    } catch (err) {
      expect((err as VpDataError).code).toBe("invalid-data");
    }
    try {
      parseXyz("the quick brown fox\njumps over the dog");
      expect.unreachable();
    } catch (err) {
      expect((err as VpDataError).code).toBe("invalid-data");
      expect((err as VpDataError).detail).toContain("none parsed");
    }
  });

  it("enforces the allocation guard by truncating, not crashing", () => {
    const text = Array.from({ length: 50 }, (_, i) => `${i} 0 0`).join("\n");
    const r = parseXyz(text, { maxPoints: 10 });
    expect(r.pointCount).toBe(10);
  });
});

describe("XyzAdapter", () => {
  const adapter = new XyzAdapter();

  it("probes coordinate text high and binary low", () => {
    const good = adapter.probe({
      header: enc("0 0 0\n1 2 3\n4 5 6\n"), filename: "cloud.xyz",
    });
    expect(good.confidence).toBeGreaterThan(0.7);
    const binary = adapter.probe({
      header: new Uint8Array([0x4c, 0x41, 0x53, 0x46, 0, 1, 2, 0]), filename: "mystery.dat",
    });
    expect(binary.confidence).toBe(0);
    const extBoost = adapter.probe({
      header: enc("0 0 0\n1 2 3\n"), filename: "cloud.xyz",
    });
    const noExt = adapter.probe({ header: enc("0 0 0\n1 2 3\n") });
    expect(extBoost.confidence).toBeGreaterThan(noExt.confidence);
  });

  it("probes non-coordinate text low", () => {
    const prose = adapter.probe({ header: enc("dear sir,\nplease find attached\nmy invoice\n") });
    expect(prose.confidence).toBeLessThan(0.5);
  });

  it("inspects and opens with real pointCount/bounds and chunk 0", async () => {
    const text = "0 0 0\n2 0 0\n2 3 0\n0 3 6";
    const src = new MemorySource(enc(text), "box.xyz");
    const info = await adapter.inspect(src);
    expect(info.format).toBe("xyz");
    expect(info.kind).toBe("point-cloud");
    expect(info.metadata.pointCount).toBe(4);
    expect(info.metadata.bounds && boundsEquals(info.metadata.bounds, {
      min: [0, 0, 0], max: [2, 3, 6],
    })).toBe(true);
    expect(info.metadata.fields?.some((f) => f.semantic === "position")).toBe(true);

    const ds = await adapter.open(src);
    expect(ds.chunkCount).toBe(1);
    const chunk = await ds.readChunk(0);
    expect(chunk.pointCount).toBe(4);
    expect(chunk.positions).toBeInstanceOf(Float32Array);
    expect(chunk.intensity?.length).toBe(4);
    expect(chunk.bounds.max).toEqual([2, 3, 6]);
    expect(ds.info.metadata.sourceSizeBytes).toBe(text.length);
    ds.dispose();
    await expect(ds.readChunk(0)).rejects.toMatchObject({ code: "invalid-data" });
  });

  it("rejects chunk indexes beyond 0", async () => {
    const src = new MemorySource(enc("0 0 0"));
    const ds = await adapter.open(src);
    await expect(ds.readChunk(1)).rejects.toMatchObject({ code: "invalid-data" });
  });
});

describe("FormatRegistry detection", () => {
  it("ranks the matching adapter above non-matching", async () => {
    const registry = new FormatRegistry();
    registry.register(new XyzAdapter());
    const src = new MemorySource(enc("1 2 3\n4 5 6"), "points.xyz");
    const det = await registry.detect(src);
    expect(det.adapter.id).toBe("xyz");
    expect(det.probe.confidence).toBeGreaterThan(0.5);
    expect(det.candidates[0].id).toBe("xyz");
  });

  it("throws structured unsupported-format for garbage", async () => {
    const registry = new FormatRegistry();
    registry.register(new XyzAdapter());
    const src = new MemorySource(new Uint8Array([0, 1, 2, 3, 0, 0, 0, 0]), "blob.dat");
    await expect(registry.detect(src)).rejects.toMatchObject({ code: "unsupported-format" });
  });

  it("reports an explicit tie as ambiguous, not a silent guess", async () => {
    // Distinct format id (registry keys by id) that probes identically to xyz.
    class TiedAdapter extends XyzAdapter {
      override readonly id = "ply" as const;
      override probe(ctx: { header: Uint8Array; filename?: string; mime?: string; size?: number }) {
        return { ...super.probe(ctx), reason: "tied clone" };
      }
    }
    const registry = new FormatRegistry();
    registry.register(new XyzAdapter());
    registry.register(new TiedAdapter());
    const src = new MemorySource(enc("1 2 3\n4 5 6"), "points.xyz");
    const err = await registry.detect(src).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported-format" });
    expect(err.detail).toContain("ties");
  });

  it("detects by content even with a wrong extension", async () => {
    const registry = new FormatRegistry();
    registry.register(new XyzAdapter());
    const src = new MemorySource(enc("1 2 3\n4 5 6\n7 8 9"), "mystery.bin");
    const det = await registry.detect(src);
    expect(det.adapter.id).toBe("xyz");
  });

  it("does not accept xyz extension when content is binary (§57)", async () => {
    const registry = new FormatRegistry();
    registry.register(new XyzAdapter());
    const src = new MemorySource(new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]), "points.xyz");
    await expect(registry.detect(src)).rejects.toMatchObject({ code: "unsupported-format" });
  });
});

describe("looksBinary", () => {
  it("flags NUL bytes and control runs, passes plain text", () => {
    expect(looksBinary(new Uint8Array([0x4c, 0, 0x46, 0x53]))).toBe(true);
    expect(looksBinary(enc("plain ascii text line\n"))).toBe(false);
    expect(looksBinary(new Uint8Array())).toBe(false);
  });
});
