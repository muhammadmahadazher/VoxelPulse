/** Coordinate spaces (§1, §27, §35–38, §83–84). Three spaces, never mixed:
 *
 *  dataset/source coordinates  — factual, as decoded (Float64 when needed)
 *  world/project coordinates   — after CRS transform into the project CRS
 *  render coordinates          — world minus RenderOrigin, Float32, GPU-only
 *
 *  The inspector reports world/source; the renderer only ever sees render. */
import type { Bounds3D } from "../data/bounds";
import { boundsFromPositions, unionBounds } from "../data/bounds";
import type { DecodedChunk } from "../data/formats/types";
import type { SpatialReference } from "./reference";
import { transformPositions } from "./transform";

/** Light branding — enough to stop accidental space mixing (§27). */
declare const spaceBrand: unique symbol;
export type DatasetCoordinate = number & { readonly [spaceBrand]: "dataset" };
export type WorldCoordinate = number & { readonly [spaceBrand]: "world" };
export type RenderCoordinate = number & { readonly [spaceBrand]: "render" };
export const asWorld = (v: number) => v as WorldCoordinate;
export const asRender = (v: number) => v as RenderCoordinate;

/** The explicit render origin (§83) — never a scattered offset field. */
export interface RenderOrigin {
  /** World (project CRS) coordinates of the render origin. */
  readonly world: readonly [number, number, number];
  /** Settable through rebasing (§38); treat as immutable snapshots. */
}

export function makeRenderOrigin(world: readonly [number, number, number]): RenderOrigin {
  return { world: [world[0], world[1], world[2]] };
}

/** world − origin = render (Float64 math here; Float32 happens at GPU upload). */
export function worldToRender(origin: RenderOrigin, p: readonly [number, number, number]): [RenderCoordinate, RenderCoordinate, RenderCoordinate] {
  return [
    (p[0] - origin.world[0]) as RenderCoordinate,
    (p[1] - origin.world[1]) as RenderCoordinate,
    (p[2] - origin.world[2]) as RenderCoordinate,
  ];
}

/** render + origin = world (picking, camera bridges — §66). */
export function renderToWorld(origin: RenderOrigin, p: readonly [number, number, number]): [WorldCoordinate, WorldCoordinate, WorldCoordinate] {
  return [
    (p[0] + origin.world[0]) as WorldCoordinate,
    (p[1] + origin.world[1]) as WorldCoordinate,
    (p[2] + origin.world[2]) as WorldCoordinate,
  ];
}

export interface PreparedChunk {
  /** Render-local Float32 positions ready for GPU upload (§84). */
  positions: Float32Array;
  /** Bounds of the rendered points in render space (Float64 numbers). */
  renderBounds: Bounds3D;
  /** Bounds in world/project space (for project overview, framing, §95). */
  worldBounds: Bounds3D;
}

export interface ChunkPrepareOptions {
  sourceRef: SpatialReference;
  projectRef: SpatialReference;
  origin: RenderOrigin;
}

/** §84 pipeline for one chunk: CRS transform (Float64) → subtract origin →
 *  Float32. The input chunk is NOT mutated (§43); temporary Float64 arrays
 *  are released when this returns (§85–86). Identity transforms skip the
 *  projection engine entirely (§84 optimized local path). */
export function prepareChunk(chunk: DecodedChunk, opts: ChunkPrepareOptions): PreparedChunk {
  const n = chunk.pointCount;
  const world = transformPositions(chunk.positions, n, opts.sourceRef, opts.projectRef, {
    outType: "float64",
  });
  const positions = new Float32Array(n * 3);
  const [ox, oy, oz] = opts.origin.world;
  for (let i = 0; i < n; i++) {
    positions[i * 3] = world[i * 3] - ox;
    positions[i * 3 + 1] = world[i * 3 + 1] - oy;
    positions[i * 3 + 2] = world[i * 3 + 2] - oz;
  }
  const renderBounds = boundsFromPositions(positions, n);
  const worldBounds: Bounds3D = {
    min: [renderBounds.min[0] + ox, renderBounds.min[1] + oy, renderBounds.min[2] + oz],
    max: [renderBounds.max[0] + ox, renderBounds.max[1] + oy, renderBounds.max[2] + oz],
  };
  return { positions, renderBounds, worldBounds };
}

/** Stable default origin: center of the first aligned chunk's world bounds
 *  (§37). Explicitly NOT camera-driven — rebasing support comes later (§38). */
export function originFromBounds(b: Bounds3D): RenderOrigin {
  return makeRenderOrigin([
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ]);
}

/** Union of world bounds across layers, project-CRS space (§95). */
export function unionWorldBounds(bounds: Bounds3D[]): Bounds3D | null {
  let acc: Bounds3D | null = null;
  for (const b of bounds) acc = acc ? unionBounds(acc, b) : b;
  return acc;
}
