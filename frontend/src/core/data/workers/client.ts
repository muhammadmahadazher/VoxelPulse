/** Main-thread worker client (§27). One shared pool for the whole app;
 *  falls back to in-place decoding when Workers are unavailable (tests/SSR)
 *  so the data pipeline still functions. */
import type { DecodedChunk } from "../formats/types";
import type { DataFormat } from "../types";
import { boundsFromPositions } from "../bounds";
import { parseXyz } from "../formats/parsers/xyz";
import { parseLas } from "../formats/parsers/las";
import { parsePly } from "../formats/parsers/ply";
import { parsePcd } from "../formats/parsers/pcd";
import { createLogger } from "../logging";
import { prepareNodeInPlace } from "./prepareInPlace";
import { WorkerPool, type PoolWorker } from "./pool";
import type { JobPriority } from "./protocol";

const log = createLogger("decode-client");

function defaultSpawn(): PoolWorker {
  return new Worker(new URL("./decodeWorker.ts", import.meta.url), { type: "module" }) as unknown as PoolWorker;
}

let pool: WorkerPool | null = null;
let poolBroken = false;

function getPool(): WorkerPool | null {
  if (poolBroken) return null;
  // diagnostic escape hatch: force main-thread decode/prepare
  try {
    if (localStorage.getItem("voxelpulse.nopool") === "1") return null;
  } catch { /* non-DOM */ }
  if (typeof Worker === "undefined") {
    poolBroken = true; // SSR/test environment — decode in-place (§27 fallback)
    return null;
  }
  if (!pool) {
    try {
      pool = new WorkerPool({ spawn: defaultSpawn });
    } catch {
      poolBroken = true;
      log.info("Workers unavailable — decoding on main thread");
      return null;
    }
  }
  return pool;
}

/** Test/diagnostic hook. */
export function setPool(p: WorkerPool | null): void {
  pool = p;
  poolBroken = false;
}

export function decodeInPlace(format: DataFormat, buffer: ArrayBuffer): {
  pointCount: number;
  positions: Float32Array | Float64Array;
  intensity?: Float32Array;
  colors?: Uint8Array;
  classification?: Uint8Array;
} {
  switch (format) {
    case "xyz": return parseXyz(new TextDecoder().decode(buffer));
    case "las": {
      const r = parseLas(buffer);
      return { ...r, colors: r.colors ?? undefined, classification: r.classification ?? undefined };
    }
    case "ply": {
      const r = parsePly(buffer);
      return { ...r, colors: r.colors ?? undefined };
    }
    case "pcd": {
      const r = parsePcd(buffer);
      return { ...r, colors: r.colors ?? undefined };
    }
    default: throw new Error(`no decoder for ${format}`);
  }
}

/** Decode a chunk payload — via the pool when possible, else in-place. */
export async function decodeChunkData(
  format: DataFormat,
  buffer: ArrayBuffer,
  opts?: { signal?: AbortSignal; priority?: JobPriority },
): Promise<DecodedChunk> {
  const p = getPool();
  if (p) {
    try {
      const result = await p.run(
        { type: "decode", priority: opts?.priority ?? "normal", payload: { format, buffer } },
        {
          signal: opts?.signal,
          extract: (r) => ({
            index: 0,
            pointCount: r.pointCount,
            positions: (r.positionsType as string) === "f64" ? new Float64Array(r.positions) : new Float32Array(r.positions),
            intensity: r.intensity ? new Float32Array(r.intensity) : undefined,
            colors: r.colors ? new Uint8Array(r.colors) : undefined,
            classification: r.classification ? new Uint8Array(r.classification) : undefined,
            bounds: r.bounds,
            fields: [],
          }),
        },
      );
      return result;
    } catch (e) {
      if (opts?.signal?.aborted) throw e; // genuine cancellation
      log.warn("worker decode failed — falling back to main thread", e);
    }
  }
  const parsed = decodeInPlace(format, buffer);
  return {
    index: 0,
    pointCount: parsed.pointCount,
    positions: parsed.positions,
    intensity: parsed.intensity,
    colors: parsed.colors,
    classification: parsed.classification,
    bounds: boundsFromPositions(parsed.positions, parsed.pointCount),
    fields: [],
  };
}
export interface PreparedNode {
  nodeId: string;
  pointCount: number;
  positions: Float32Array;
  intensity: Float32Array;
  colors?: Uint8Array;
  classification?: Uint8Array;
  worldBounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface PrepareNodeOptions {
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

/** §36, §104: full node preparation off-main-thread — decode + CRS transform
 *  + origin subtraction. Falls back to main-thread only when Workers are
 *  unavailable (the decode path's existing fallback). */
export async function prepareNodeData(
  nodeId: string,
  buffer: ArrayBuffer,
  opts: PrepareNodeOptions,
): Promise<PreparedNode> {
  const p = getPool();
  if (p) {
    try {
      // The pool transfers the payload buffer (§26) — hand it a copy so the
      // caller's buffer survives for the main-thread fallback below.
      return await p.run(
        {
          type: "prepare-node",
          priority: "interactive",
          payload: {
            format: "copc",
            buffer: buffer.slice(0),
            ...opts,
          },
        },
        {
          signal: undefined,
          extract: (r) => ({
            nodeId: (r as { nodeId?: string }).nodeId ?? nodeId,
            pointCount: r.pointCount,
            positions: new Float32Array(r.positions),
            intensity: r.intensity ? new Float32Array(r.intensity) : new Float32Array(r.pointCount),
            colors: r.colors ? new Uint8Array(r.colors) : undefined,
            classification: r.classification ? new Uint8Array(r.classification) : undefined,
            worldBounds: r.bounds,
          }),
        },
      );
    } catch (e) {
      log.warn("worker prepare failed — falling back to main thread", e);
    }
  }
  // Main-thread fallback (tests / no-Worker environments): same pipeline.
  const data = await prepareNodeInPlace({
    nodeId,
    buffer,
    pointFormat: opts.pointFormat,
    pointRecordLength: opts.pointRecordLength,
    pointCount: opts.pointCount,
    compressed: opts.compressed,
    scales: opts.scales,
    offsets: opts.offsets,
    sourceProj: opts.sourceProj,
    targetProj: opts.targetProj,
    origin: opts.origin,
  });
  return {
    nodeId,
    pointCount: data.pointCount,
    positions: data.positions,
    intensity: data.intensity,
    colors: data.colors,
    classification: data.classification,
    worldBounds: data.worldBounds,
  };
}
