/** Node preparation pipeline (§36, §104) — PURE logic shared by the worker
 *  and the main-thread fallback: decode (LAZ via laz-perf, or raw records) →
 *  CRS transform in Float64 → render-origin subtraction → Float32 + attrs.
 *  No worker/DOM imports — runs in both environments. */
import { createLogger } from "../logging";

const log = createLogger("prepare");

export interface PrepareNodePayload {
  nodeId?: string;
  buffer: ArrayBuffer;
  pointFormat: number;
  pointRecordLength: number;
  pointCount: number;
  compressed: boolean;
  scales: [number, number, number];
  offsets: [number, number, number];
  sourceProj?: string;
  targetProj?: string;
  origin: [number, number, number];
}

export interface PreparedNodeData {
  pointCount: number;
  positions: Float32Array;
  intensity: Float32Array;
  colors?: Uint8Array;
  classification?: Uint8Array;
  worldBounds: { min: [number, number, number]; max: [number, number, number] };
}

/** laz-perf WASM module cached per environment (§103). */
interface LazPerfModule {
  _malloc(n: number): number;
  _free(p: number): void;
  HEAPU8: Uint8Array;
  ChunkDecoder: new () => { open(fmt: number, len: number, ptr: number): void; getPoint(ptr: number): void; delete(): void };
}
let lazPerfModule: Promise<LazPerfModule> | null = null;

export function setLazPerfFactory(create: () => Promise<unknown>): void {
  lazPerfModule = create() as Promise<LazPerfModule>;
}

async function getLazPerf(): Promise<LazPerfModule> {
  if (!lazPerfModule) {
    const mod = await import("laz-perf");
    // Browser/worker: the Emscripten scriptDirectory resolves the wasm
    // through Vite's dep pre-bundle to index.html ("expected magic word")
    // — hand it the real asset URL instead (§5 dependency note).
    let opts: { locateFile: (f: string) => string } | undefined;
    if (typeof process === "undefined" || !process.versions?.node) {
      try {
        const u = await import("laz-perf/lib/laz-perf.wasm?url");
        opts = { locateFile: () => u.default };
      } catch { /* fall back to scriptDirectory */ }
    }
    lazPerfModule = mod.createLazPerf(opts as never) as Promise<LazPerfModule>;
  }
  return lazPerfModule;
}

export async function prepareNodeInPlace(p: PrepareNodePayload): Promise<PreparedNodeData> {
  const scale = p.scales ?? [1, 1, 1];
  const offs = p.offsets ?? [0, 0, 0];
  const n = p.pointCount;
  const world = new Float64Array(n * 3);
  const intensity = new Float32Array(n);
  let classification: Uint8Array | undefined;
  let colors: Uint8Array | undefined;
  const hasRgb = p.pointFormat === 2 || p.pointFormat === 3 || p.pointFormat === 5 ||
    p.pointFormat === 7 || p.pointFormat === 8;
  const hasClass = [0, 1, 4, 6].includes(p.pointFormat);
  if (hasClass) classification = new Uint8Array(n);
  if (hasRgb) colors = new Uint8Array(n * 3);

  if (p.compressed) {
    const LazPerf = await getLazPerf();
    const blobPtr = LazPerf._malloc(p.buffer.byteLength);
    const dataPtr = LazPerf._malloc(p.pointRecordLength);
    let decoder: { open(fmt: number, len: number, ptr: number): void; getPoint(ptr: number): void; delete(): void } | null = null;
    try {
      LazPerf.HEAPU8.set(new Uint8Array(p.buffer), blobPtr);
      decoder = new LazPerf.ChunkDecoder();
      decoder.open(p.pointFormat, p.pointRecordLength, blobPtr);
      const heapDv = new DataView(LazPerf.HEAPU8.buffer);
      for (let i = 0; i < n; i++) {
        decoder.getPoint(dataPtr);
        const o = dataPtr;
        world[i * 3] = heapDv.getInt32(o, true) * scale[0] + offs[0];
        world[i * 3 + 1] = heapDv.getInt32(o + 4, true) * scale[1] + offs[1];
        world[i * 3 + 2] = heapDv.getInt32(o + 8, true) * scale[2] + offs[2];
        intensity[i] = heapDv.getUint16(o + 12, true) / 65535;
        if (classification) classification[i] = LazPerf.HEAPU8[o + 15] & 0x1f;
        if (colors) {
          colors[i * 3] = heapDv.getUint16(o + 29, true) >> 8;
          colors[i * 3 + 1] = heapDv.getUint16(o + 31, true) >> 8;
          colors[i * 3 + 2] = heapDv.getUint16(o + 33, true) >> 8;
        }
      }
    } finally {
      decoder?.delete();
      LazPerf._free(blobPtr);
      LazPerf._free(dataPtr);
    }
  } else {
    const rec = new DataView(p.buffer);
    const stride = p.pointRecordLength;
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      world[i * 3] = rec.getInt32(o, true) * scale[0] + offs[0];
      world[i * 3 + 1] = rec.getInt32(o + 4, true) * scale[1] + offs[1];
      world[i * 3 + 2] = rec.getInt32(o + 8, true) * scale[2] + offs[2];
      intensity[i] = rec.getUint16(o + 12, true) / 65535;
      if (classification) classification[i] = rec.getUint8(o + 15) & 0x1f;
      if (colors) {
        colors[i * 3] = rec.getUint16(o + 29, true) >> 8;
        colors[i * 3 + 1] = rec.getUint16(o + 31, true) >> 8;
        colors[i * 3 + 2] = rec.getUint16(o + 33, true) >> 8;
      }
    }
  }

  // §87–88: CRS transform in Float64 before any narrowing.
  if (p.sourceProj && p.targetProj && p.sourceProj !== p.targetProj) {
    const proj4 = (await import("proj4")).default;
    const conv = proj4(p.sourceProj, p.targetProj) as unknown as { forward: (pt: number[]) => number[] };
    const tmp: number[] = [0, 0];
    for (let i = 0; i < n; i++) {
      tmp[0] = world[i * 3];
      tmp[1] = world[i * 3 + 1];
      const t = conv.forward(tmp);
      world[i * 3] = t[0];
      world[i * 3 + 1] = t[1];
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const positions = new Float32Array(n * 3);
  const [ox, oy, oz] = p.origin;
  for (let i = 0; i < n; i++) {
    const x = world[i * 3], y = world[i * 3 + 1], z = world[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    positions[i * 3] = x - ox;
    positions[i * 3 + 1] = y - oy;
    positions[i * 3 + 2] = z - oz;
  }
  log.debug(`prepared ${n} pts (${p.compressed ? "LAZ" : "raw"})`);
  return {
    pointCount: n,
    positions,
    intensity,
    colors,
    classification,
    worldBounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}
