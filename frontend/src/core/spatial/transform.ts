/** Transform service (§28–31, §60). Central projection engine wrapper over
 *  proj4. Compiled transforms are cached per (from,to) pair (§31); horizontal
 *  transforms never touch Z (§60 — no pretend vertical reprojection); batch
 *  paths operate on typed arrays without per-point object allocation beyond
 *  the 2-tuple the engine consumes (§29). Identity pairs skip the loop. */
import proj4 from "proj4";
import type { SpatialReference } from "./reference";
import { sameReference } from "./reference";
import { isKnownRef } from "./reference";
import { VpDataError } from "../data/errors";
import { createLogger } from "../data/logging";

const log = createLogger("transform");

type ProjConverter = { forward: (pt: number[]) => number[]; inverse: (pt: number[]) => number[] };

const cache = new Map<string, ProjConverter | null>();

function pairKey(from: SpatialReference, to: SpatialReference): string {
  return `${from.id}=>${to.id}`;
}

/** Compiled transform for a pair, or null for identity pairs. Cached (§31). */
export function getTransform(from: SpatialReference, to: SpatialReference): ProjConverter | null {
  const key = pairKey(from, to);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let converter: ProjConverter | null = null;
  if (!sameReference(from, to)) {
    if (!isKnownRef(from) || !isKnownRef(to)) {
      throw new VpDataError(
        "unsupported-format",
        `Cannot transform between ${from.name ?? from.id} and ${to.name ?? to.id}.`,
        { detail: "both references must be georeferenced (projected/geographic)", context: { from: from.id, to: to.id } },
      );
    }
    if (!from.projString || !to.projString) {
      throw new VpDataError("unsupported-format", "One of the spatial references has no transformable definition.", {
        context: { from: from.id, to: to.id },
      });
    }
    converter = proj4(from.projString, to.projString) as unknown as ProjConverter;
    if (cache.size > 256) cache.clear(); // bounded (§106)
    cache.set(key, converter);
    log.debug(`compiled transform ${key}`);
  } else {
    cache.set(key, null);
  }
  return converter;
}

/** Transform one point [x, y, z] (VoxelPulse axis convention: x=easting|lon).
 *  Z passes through untouched (§60). */
export function transformPoint(
  point: readonly [number, number, number],
  from: SpatialReference,
  to: SpatialReference,
): [number, number, number] {
  const conv = getTransform(from, to);
  if (!conv) return [point[0], point[1], point[2]];
  const out = conv.forward([point[0], point[1]]);
  return [out[0], out[1], point[2]];
}

/** Inverse transform (world → geographic, etc.). */
export function inverseTransformPoint(
  point: readonly [number, number, number],
  from: SpatialReference,
  to: SpatialReference,
): [number, number, number] {
  const conv = getTransform(from, to);
  if (!conv) return [point[0], point[1], point[2]];
  const out = conv.inverse([point[0], point[1]]);
  return [out[0], out[1], point[2]];
}

/** Batch-transform interleaved XYZ positions (§29). Returns a new array of
 *  `outType` (default: matching input) or writes into `into` when given.
 *  Identity pairs copy (or pass through with `into`). */
export function transformPositions(
  positions: Float32Array | Float64Array,
  pointCount: number,
  from: SpatialReference,
  to: SpatialReference,
  opts?: { into?: Float64Array; outType?: "float32" | "float64" },
): Float32Array | Float64Array {
  const conv = getTransform(from, to);
  const n = Math.min(pointCount, Math.floor(positions.length / 3));
  const useF64 = opts?.outType === "float64" || (!opts?.outType && positions instanceof Float64Array);
  if (!conv) {
    if (opts?.into) {
      opts.into.set(positions.subarray(0, n * 3));
      return opts.into;
    }
    if (useF64 && !(positions instanceof Float64Array)) {
      return new Float64Array(positions.subarray(0, n * 3));
    }
    return positions.slice(0, n * 3);
  }
  const out = opts?.into ?? (useF64 ? new Float64Array(n * 3) : new Float32Array(n * 3));
  const tmp: number[] = [0, 0];
  for (let i = 0; i < n; i++) {
    tmp[0] = positions[i * 3];
    tmp[1] = positions[i * 3 + 1];
    const t = conv.forward(tmp);
    out[i * 3] = t[0];
    out[i * 3 + 1] = t[1];
    out[i * 3 + 2] = positions[i * 3 + 2];
  }
  return out;
}

/** Test/diagnostic view of the cache. */
export function transformCacheSize(): number {
  return cache.size;
}
