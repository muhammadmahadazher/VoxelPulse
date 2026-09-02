/** §57 format test matrix — per adapter: valid open, truncated, invalid
 *  header, wrong-extension detection, right-extension/wrong-content refusal,
 *  cancellation, plus registry cross-detection. Fixtures are the committed
 *  tiny.* files (§56); malformed variants are derived in-memory. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FormatRegistry, formatRegistry } from "./registry";
import { registerBuiltinAdapters } from "./index";
import { MemorySource } from "../source/memory";
import { VpDataError } from "../errors";

// Resolve the fixtures dir across dev layouts (workspace vs junction mirror).
const FIX = ["../../../tests/fixtures", "../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "tiny.xyz")))!;
const read = (name: string) => readFileSync(join(FIX, name));
const ab = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

let registry: FormatRegistry;
beforeAll(() => {
  registerBuiltinAdapters();
  registry = formatRegistry;
});

describe.each([
  { format: "las", file: "tiny.las", points: 40, binary: true },
  { format: "ply", file: "tiny.ply", points: 25, binary: false },
  { format: "ply", file: "tiny-binary.ply", points: 25, binary: true },
  { format: "pcd", file: "tiny.pcd", points: 25, binary: false },
  { format: "pcd", file: "tiny-binary.pcd", points: 25, binary: true },
])("adapter matrix: $format ($file)", ({ format, file, points, binary }) => {
  it("detects, inspects and opens the valid fixture", async () => {
    const src = new MemorySource(ab(read(file)), file);
    const det = await registry.detect(src);
    expect(det.adapter.id).toBe(format);
    expect(det.probe.confidence).toBeGreaterThanOrEqual(0.9);

    const info = await det.adapter.inspect(src);
    expect(info.metadata.pointCount).toBe(points);
    expect(info.metadata.fields?.some((f) => f.semantic === "position")).toBe(true);
    expect(info.metadata.sourceSizeBytes).toBe(read(file).byteLength);
    if (format === "las") {
      expect(info.metadata.formatVersion).toBe("1.2");
      expect(info.metadata.bounds).toBeDefined(); // header bounds via partial read
      expect(info.metadata.formatSpecific?.las?.pointFormat).toBe(0);
    }

    const ds = await det.adapter.open(src);
    const chunk = await ds.readChunk(0);
    expect(chunk.pointCount).toBe(points);
    expect(chunk.positions.length).toBe(points * 3);
    for (let i = 0; i < chunk.positions.length; i++) expect(Number.isFinite(chunk.positions[i])).toBe(true);
    expect(chunk.bounds.max[0]).toBeGreaterThanOrEqual(chunk.bounds.min[0]);
    expect(chunk.intensity?.length).toBe(points);
  });

  it("rejects a truncated body with a structured error", async () => {
    const full = read(file);
    const cut = binary ? full.subarray(0, full.byteLength - 40) : Buffer.from(full.toString("utf8").slice(0, -30), "utf8");
    const src = new MemorySource(ab(cut), file);
    const det = await registry.detect(src);
    const ds = await det.adapter.open(src);
    const err = await ds.readChunk(0).catch((e) => e);
    expect(err).toBeInstanceOf(VpDataError);
    expect(["invalid-data", "decode-failed"]).toContain(err.code);
  });

  it("rejects corrupted headers", async () => {
    const full = Buffer.from(read(file));
    full.fill(0, 0, Math.min(64, full.length)); // smash magic + structural header lines
    const src = new MemorySource(ab(full), file);
    await expect(registry.detect(src)).rejects.toMatchObject({ code: "unsupported-format" });
  });

  it("cancellation short-circuits inspect", async () => {
    const src = new MemorySource(ab(read(file)), file);
    const ctrl = new AbortController();
    ctrl.abort();
    const det = await registry.detect(src);
    const err = await det.adapter.inspect(src, ctrl.signal).catch((e) => e);
    expect(err).toMatchObject({ code: "cancelled" });
  });
});

describe("cross-format detection (§57)", () => {
  const files = ["tiny.las", "tiny.ply", "tiny.pcd", "tiny.xyz", "tiny-binary.ply", "tiny-binary.pcd"];
  const expectFormat = ["las", "ply", "pcd", "xyz", "ply", "pcd"];

  it.each(files.map((f, i) => [f, expectFormat[i]] as const))(
    "%s → %s by content",
    async (file, expected) => {
      const src = new MemorySource(ab(read(file)), file);
      const det = await registry.detect(src);
      expect(det.adapter.id).toBe(expected);
      expect(det.probe.confidence).toBeGreaterThanOrEqual(0.85);
    },
  );

  it("wrong extension does not fool detection (content wins)", async () => {
    const src = new MemorySource(ab(read("tiny.pcd")), "disguised.las");
    const det = await registry.detect(src);
    expect(det.adapter.id).toBe("pcd");
  });

  it("right extension with wrong content is not accepted as that format (§57)", async () => {
    // .las extension but XYZ text content: LAS must NOT claim it; content
    // detection may honestly identify it as xyz instead.
    const xyzText = read("tiny.xyz");
    const src = new MemorySource(ab(xyzText), "looks_like.las");
    const det = await registry.detect(src);
    expect(det.adapter.id).not.toBe("las");
    expect(det.adapter.id).toBe("xyz");
  });

  it("totally unknown bytes produce the friendly unsupported error", async () => {
    const src = new MemorySource(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0]).buffer as ArrayBuffer, "mystery.dat");
    const err = await registry.detect(src).catch((e) => e);
    expect(err).toBeInstanceOf(VpDataError);
    expect(err.message).toContain("couldn't identify");
  });
});

describe("format-specific rejections", () => {
  it("LAS: LAZ compression bit → structured unsupported error (no LAZ claims)", async () => {
    const buf = Buffer.from(read("tiny.las"));
    buf.writeUInt8(0x80 | 0x01, 106); // point format 1 + compression bit
    const src = new MemorySource(ab(buf), "compressed.las");
    const det = await registry.detect(src);
    const err = await det.adapter.inspect(src).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported-format" });
    expect(String(err.message + err.detail)).toContain("LAZ");
  });

  it("PCD: binary_compressed → structured error with re-export hint", async () => {
    const text = read("tiny.pcd").toString("utf8").replace("DATA ascii", "DATA binary_compressed");
    const src = new MemorySource(ab(Buffer.from(text, "utf8")), "tiny.pcd");
    const det = await registry.detect(src);
    const err = await det.adapter.inspect(src).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported-format" });
    expect(String(err.detail + err.message)).toContain("binary_compressed");
  });

  it("PLY: mesh-only vertex schema (no x/y/z) → structured unsupported error", async () => {
    const mesh = ["ply", "format ascii 1.0", "element vertex 3",
      "property uchar red", "property uchar green", "property uchar blue", "end_header",
      "255 0 0", "0 255 0", "0 0 255", ""].join("\n");
    const src = new MemorySource(ab(Buffer.from(mesh, "utf8")), "mesh.ply");
    const det = await registry.detect(src);
    const err = await det.adapter.inspect(src).catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported-format" });
    expect(String(err.message + err.detail)).toContain("x/y/z");
  });
});
