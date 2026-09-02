import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { MemorySource } from "./source/memory";
import { LocalFileSource } from "./source/localFile";
import { UrlSource, RangeCache } from "./source/url";
import { isCancelledError } from "./errors";
import type { ByteRange } from "./source/types";

describe("MemorySource", () => {
  it("reads full and ranged views and reports capabilities", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const src = new MemorySource(data, "test buffer");
    expect(await src.size()).toBe(8);
    expect(new Uint8Array(await src.read())).toEqual(data);
    const r1: ByteRange = { offset: 2, length: 3 };
    expect(new Uint8Array(await src.read(r1))).toEqual(new Uint8Array([3, 4, 5]));
    const beyond: ByteRange = { offset: 6, length: 100 };
    expect(new Uint8Array(await src.read(beyond)).byteLength).toBe(2); // clamped
    expect(src.capabilities.randomAccess).toBe(true);
    expect(src.capabilities.knownSize).toBe(true);
    expect(await src.fingerprint()).toMatch(/^memory:test buffer:8$/);
  });

  it("rejects reads after abort", async () => {
    const src = new MemorySource(new Uint8Array(4));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(src.read(undefined, ctrl.signal)).rejects.toSatisfy(isCancelledError);
  });
});

describe("LocalFileSource", () => {
  it("slices a File by range and builds an honest descriptor", async () => {
    const payload = new TextEncoder().encode("hello voxel world");
    const file = new File([payload], "scan.xyz", { lastModified: 1_700_000_000_000 });
    const src = new LocalFileSource(file);
    expect(await src.size()).toBe(payload.byteLength);
    const mid = await src.read({ offset: 6, length: 5 });
    expect(new TextDecoder().decode(mid)).toBe("voxel");
    expect(src.capabilities.persistentReference).toBe(false); // honest (§46)
    const d = src.descriptor();
    expect(d).toMatchObject({ kind: "local-file", name: "scan.xyz", size: payload.byteLength });
    expect(await src.fingerprint()).toContain("scan.xyz");
  });
});

describe("RangeCache", () => {
  it("evicts least-recently-used beyond budget", () => {
    const cache = new RangeCache(300);
    const put = (i: number, bytes: number) =>
      cache.put(`u${i}`, { offset: 0, length: bytes }, new ArrayBuffer(bytes));
    put(1, 100);
    put(2, 100);
    cache.get("u1", { offset: 0, length: 100 }); // refresh u1
    put(3, 150); // 350 > 300 → evicts u2 (LRU), keeps u1+u3 = 250 ≤ 300
    expect(cache.count).toBe(2);
    expect(cache.get("u2", { offset: 0, length: 100 })).toBeUndefined();
    expect(cache.get("u1", { offset: 0, length: 100 })).toBeDefined();
    expect(cache.get("u3", { offset: 0, length: 150 })).toBeDefined();
    cache.clear();
    expect(cache.count).toBe(0);
    expect(cache.size).toBe(0);
  });
});

describe("UrlSource", () => {
  let server: http.Server;
  let base = "";
  let requests: Array<{ method: string; range: string | undefined; url: string }> = [];
  let mode: "range" | "no-range" | "404" = "range";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const range = req.headers.range;
      requests.push({ method: req.method ?? "?", range, url: req.url ?? "/" });
      if (mode === "404") {
        res.writeHead(404, { "content-length": 0 });
        res.end();
        return;
      }
      const body = Buffer.from("0123456789abcdef"); // 16 bytes
      if (range && mode === "range") {
        const m = /bytes=(\d+)-(\d+)/.exec(range)!;
        const start = parseInt(m[1], 10);
        const end = Math.min(parseInt(m[2], 10), body.length - 1);
        const slice = body.subarray(start, end + 1);
        res.writeHead(206, {
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "accept-ranges": "bytes",
          "content-length": slice.length,
        });
        res.end(slice);
        return;
      }
      res.writeHead(200, {
        "content-length": body.length,
        "accept-ranges": mode === "range" ? "bytes" : "none",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/data.bin`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads the full body and learns size", async () => {
    requests = [];
    const src = new UrlSource(base);
    const buf = await src.read();
    expect(Buffer.from(buf).toString()).toBe("0123456789abcdef");
    expect(await src.size()).toBe(16);
  });

  it("uses HTTP ranges (206) for partial reads", async () => {
    requests = [];
    const src = new UrlSource(base);
    const slice = await src.read({ offset: 4, length: 4 });
    expect(Buffer.from(slice).toString()).toBe("4567");
    expect(requests.some((r) => r.range === "bytes=4-7")).toBe(true);
  });

  it("serves repeat reads from the range cache without new requests", async () => {
    requests = [];
    const src = new UrlSource(base);
    const a = await src.read({ offset: 0, length: 4 });
    const b = await src.read({ offset: 0, length: 4 });
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
    const rangeRequests = requests.filter((r) => r.range === "bytes=0-3");
    expect(rangeRequests).toHaveLength(1);
  });

  it("falls back to a full read when the server ignores Range", async () => {
    requests = [];
    mode = "no-range";
    const src = new UrlSource(base);
    const slice = await src.read({ offset: 2, length: 5 });
    expect(Buffer.from(slice).toString()).toBe("23456");
    expect(requests.every((r) => r.range === undefined || r.range === "bytes=2-6")).toBe(true);
    expect(requests.some((r) => r.range === undefined)).toBe(true); // a full GET happened
    mode = "range";
  });

  it("maps 404 to a structured network error", async () => {
    mode = "404";
    const src = new UrlSource(`${base}/missing.bin`);
    const err = await src.read().catch((e) => e);
    expect(err).toMatchObject({ name: "VpDataError", code: "network-failed" });
    expect(err.message).toContain("404");
    mode = "range";
  });

  it("propagates abort as cancellation", async () => {
    requests = [];
    mode = "no-range"; // force a request path that would otherwise be cached
    const src = new UrlSource(base);
    const ctrl = new AbortController();
    const pending = src.read({ offset: 8, length: 4 }, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toSatisfy(isCancelledError);
    mode = "range";
  });

  it("rejects unreachable hosts with a CORS/network hint", async () => {
    const src = new UrlSource("http://127.0.0.1:9/never.bin");
    const err = await src.read().catch((e) => e);
    expect(err).toMatchObject({ name: "VpDataError", code: "network-failed" });
  }, 10_000);
});
