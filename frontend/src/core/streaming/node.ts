/** Octree node model + VoxelKey math (§10–12). Keys are stable spatial
 *  identifiers (level,x,y,z) — never random IDs. Bounds derive from the
 *  COPC root cube and the key. */
import type { Bounds3D } from "../data/bounds";
import type { ByteRange } from "../data/source/types";
import type { NodeState } from "../data/formats/copc/meta";

export interface PointCloudNode {
  key: VoxelKey;
  id: string;
  level: number;
  bounds: Bounds3D;
  pointCount: number;
  dataRange?: ByteRange;
  state: NodeState;
  /** Child keys that exist in the hierarchy (subset of the 8 possible). */
  childKeys: VoxelKey[];
}

export interface VoxelKey {
  level: number;
  x: number;
  y: number;
  z: number;
}

export const keyId = (k: VoxelKey): string => `${k.level}-${k.x}-${k.y}-${k.z}`;

/** Node bounds from the COPC root cube: each level halves the cube; the key
 *  selects the octant. Matches COPC semantics (spacing halves per level). */
export function nodeBounds(root: Bounds3D, key: VoxelKey): Bounds3D {
  const sizeX = (root.max[0] - root.min[0]) / 2 ** key.level;
  const sizeY = (root.max[1] - root.min[1]) / 2 ** key.level;
  const sizeZ = (root.max[2] - root.min[2]) / 2 ** key.level;
  return {
    min: [root.min[0] + key.x * sizeX, root.min[1] + key.y * sizeY, root.min[2] + key.z * sizeZ],
    max: [root.min[0] + (key.x + 1) * sizeX, root.min[1] + (key.y + 1) * sizeY, root.min[2] + (key.z + 1) * sizeZ],
  };
}

/** Spacing (point density denominator) at a level: root spacing × 2^-level. */
export function levelSpacing(rootSpacing: number, level: number): number {
  return rootSpacing / 2 ** level;
}

/** Center of a bounds pair. */
export function boundsCenter(b: Bounds3D): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}
