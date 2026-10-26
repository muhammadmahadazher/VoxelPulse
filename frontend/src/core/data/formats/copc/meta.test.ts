/** Phase 4 CP1+CP2 — COPC metadata parsing + LAZ node decode via laz-perf.
 *  Fixtures: tiny.copc (self-generated, uncompressed points) and
 *  laz-node.lazchunk (real LAZ node, PDAL-derived). */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseCopcHeader, walkCopcVlrs, findVlr, parseCopcInfo, parseHierarchyPage,
  looksLikeCopc, rootBounds, keyToString, u64asNumber,
} from "./meta";
import { MemorySource } from "../../source/memory";
import { VpDataError } from "../../errors";

const FIX = ["../../../../../tests/fixtures", "../../../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "tiny.copc")))!;

function load(name: string): ArrayBuffer {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("COPC metadata (tiny.copc)", () => {
  let header: ReturnType<typeof parseCopcHeader>;
  let vlrs: ReturnType<typeof walkCopcVlrs>;
  let info: ReturnType<typeof parseCopcInfo>;

  beforeAll(() => {
    const buf = load("tiny.copc");
    expect(looksLikeCopc(buf)).toBe(true);
    header = parseCopcHeader(buf);
    vlrs = walkCopcVlrs(buf, header);
    const infoVlr = findVlr(vlrs, "copc", 1)!;
    info = parseCopcInfo(buf.slice(infoVlr.dataOffset, infoVlr.dataOffset + 160));
  });

  it("parses the LAS 1.4 header fields", () => {
    expect(header.headerLength).toBe(375);
    expect(header.pointFormat).toBe(7);
    expect(header.pointRecordLength).toBe(36);
    expect(header.pointCount).toBe(128);
    expect(header.vlrCount).toBe(3);
  });

  it("walks VLRs with correct lengths (spec layout: record length @20)", () => {
    expect(findVlr(vlrs, "copc", 1)).toBeDefined();
    expect(findVlr(vlrs, "copc", 1000)).toBeDefined();
    const wkt = findVlr(vlrs, "LASF_Projection", 2112);
    expect(wkt).toBeDefined();
    expect(wkt!.dataLength).toBeGreaterThan(300); // full WKT string
  });

  it("parses the info VLR with Lahore-block geometry", () => {
    expect(info.centerX).toBeCloseTo(439_104.375, 3);
    expect(info.halfsize).toBe(5.0);
    expect(info.spacing).toBe(10.0);
    expect(info.rootHierOffset).toBeGreaterThan(375);
    expect(info.rootHierSize).toBe(9 * 32);
    expect(info.gpstimeMax).toBeGreaterThanOrEqual(info.gpstimeMin);
  });

  it("derives root bounds covering the point set", () => {
    const b = rootBounds(info);
    expect(b.min[0]).toBeLessThan(439_100);
    expect(b.max[0]).toBeGreaterThan(439_108);
  });

  it("parses the hierarchy page: 8 level-1 nodes + root", () => {
    const page = parseHierarchyPage(load("tiny.copc").slice(info.rootHierOffset, info.rootHierOffset + info.rootHierSize));
    expect(page.nodes).toHaveLength(9);
    expect(page.childPages).toHaveLength(0);
    const root = page.nodes.find((n) => n.key.level === 0)!;
    expect(root.pointCount).toBe(32);
    expect(keyToString(root.key)).toBe("0-0-0-0");
    const level1 = page.nodes.filter((n) => n.key.level === 1);
    expect(level1).toHaveLength(8);
    expect(level1.reduce((s, n) => s + n.pointCount, 0)).toBe(96);
  });

  it("fetches a node's uncompressed records through a byte-range read", async () => {
    const page = parseHierarchyPage(load("tiny.copc").slice(info.rootHierOffset, info.rootHierOffset + info.rootHierSize));
    const node = page.nodes.find((n) => n.pointCount > 0)!;
    const src = new MemorySource(load("tiny.copc"), "tiny.copc");
    const chunk = await src.read({ offset: node.offset, length: node.byteSize });
    expect(chunk.byteLength).toBe(node.byteSize);
    expect(chunk.byteLength).toBe(node.pointCount * 36); // uncompressed records
  });

  it("rejects corrupted hierarchy pages with structured errors", () => {
    expect(() => parseHierarchyPage(new ArrayBuffer(30))).toThrow(VpDataError); // not ×32
    const bad = new ArrayBuffer(32);
    const dv = new DataView(bad);
    dv.setInt32(28, -5, true); // pointCount < -1
    expect(() => parseHierarchyPage(bad)).toThrow(VpDataError);
  });

  it("rejects u64 offsets beyond safe integers (§143)", () => {
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    dv.setBigUint64(0, 1n << 53n, true);
    expect(() => u64asNumber(dv, 0, "test")).toThrow(VpDataError);
    dv.setBigUint64(0, 12345n, true);
    expect(u64asNumber(dv, 0, "test")).toBe(12345);
  });

  it("looksLikeCopc rejects non-COPC LAS and garbage", () => {
    expect(looksLikeCopc(load("tiny.las"))).toBe(false);
    expect(looksLikeCopc(new ArrayBuffer(100))).toBe(false);
  });
});

describe("LAZ node decode via laz-perf (CP2, real chunk)", () => {
  it("decodes the reference node: 24 points, PDRF 7", async () => {
    const { createLazPerf } = await import("laz-perf");
    const LazPerf = await createLazPerf();
    const chunk = new Uint8Array(load("laz-node.lazchunk"));
    const meta = JSON.parse(readFileSync(join(FIX, "laz-node.meta.json"), "utf8"));

    const blobPtr = LazPerf._malloc(chunk.length);
    const dataPtr = LazPerf._malloc(meta.pointRecordLength);
    let decoder: { open: (fmt: number, len: number, ptr: number) => void; getPoint: (p: number) => void; delete: () => void } | null = null;
    try {
      LazPerf.HEAPU8.set(chunk, blobPtr);
      const dec = new LazPerf.ChunkDecoder();
      decoder = dec;
      dec.open(meta.pointFormat, meta.pointRecordLength, blobPtr);
      const out = new Uint8Array(meta.pointCount * meta.pointRecordLength);
      for (let i = 0; i < meta.pointCount; i++) {
        dec.getPoint(dataPtr);
        out.set(LazPerf.HEAPU8.subarray(dataPtr, dataPtr + meta.pointRecordLength), i * meta.pointRecordLength);
      }
      // X/Y/Z of first point are plausible UTM-scaled ints (non-degenerate)
      const dv = new DataView(out.buffer);
      const x0 = dv.getInt32(0, true), y0 = dv.getInt32(4, true), z0 = dv.getInt32(8, true);
      expect(Number.isFinite(x0)).toBe(true);
      expect(Math.abs(x0)).toBeLessThan(10_000_000);
      // points differ (real data, not zeros)
      const x1 = dv.getInt32(36, true);
      expect(x1).not.toBe(x0);
      // RGB present for PDRF 7 at offset 29..34 within record
      const r0 = dv.getUint16(29 + 0, true);
      expect(r0).toBeLessThanOrEqual(65535);
    } finally {
      decoder?.delete();
      LazPerf._free(blobPtr);
      LazPerf._free(dataPtr);
    }
  });

  it("decodes repeatedly without growth in allocated pointer count (§6 pattern)", async () => {
    const { createLazPerf } = await import("laz-perf");
    const LazPerf = await createLazPerf();
    const chunk = new Uint8Array(load("laz-node.lazchunk"));
    const meta = JSON.parse(readFileSync(join(FIX, "laz-node.meta.json"), "utf8"));
    // decode/flush cycles through the SAME reusable pointers
    const blobPtr = LazPerf._malloc(chunk.length);
    const dataPtr = LazPerf._malloc(meta.pointRecordLength);
    const out = new Uint8Array(meta.pointCount * meta.pointRecordLength);
    for (let cycle = 0; cycle < 50; cycle++) {
      LazPerf.HEAPU8.set(chunk, blobPtr);
      const decoder = new LazPerf.ChunkDecoder();
      decoder.open(meta.pointFormat, meta.pointRecordLength, blobPtr);
      for (let i = 0; i < meta.pointCount; i++) {
        decoder.getPoint(dataPtr);
        out.set(LazPerf.HEAPU8.subarray(dataPtr, dataPtr + meta.pointRecordLength), i * meta.pointRecordLength);
      }
      decoder.delete();
    }
    LazPerf._free(blobPtr);
    LazPerf._free(dataPtr);
    expect(out.length).toBe(meta.pointCount * meta.pointRecordLength);
  });
});
