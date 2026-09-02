/** Axis-aligned 3D bounds in dataset-local coordinates (§9).
 *  Double-precision JS numbers; GPU conversion happens in the renderer. */

export interface Bounds3D {
  min: [number, number, number];
  max: [number, number, number];
}

export const EMPTY_BOUNDS: Bounds3D = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
};

export function isEmptyBounds(b: Bounds3D): boolean {
  return b.min[0] > b.max[0] || b.min[1] > b.max[1] || b.min[2] > b.max[2];
}

export function unionBounds(a: Bounds3D, b: Bounds3D): Bounds3D {
  if (isEmptyBounds(a)) return { min: [...b.min], max: [...b.max] };
  if (isEmptyBounds(b)) return { min: [...a.min], max: [...a.max] };
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function boundsCenter(b: Bounds3D): [number, number, number] {
  if (isEmptyBounds(b)) return [0, 0, 0];
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

export function boundsSize(b: Bounds3D): [number, number, number] {
  if (isEmptyBounds(b)) return [0, 0, 0];
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boundsDiagonal(b: Bounds3D): number {
  const [w, h, d] = boundsSize(b);
  return Math.hypot(w, h, d);
}

export function boundsContains(b: Bounds3D, p: readonly [number, number, number]): boolean {
  return (
    p[0] >= b.min[0] && p[0] <= b.max[0] &&
    p[1] >= b.min[1] && p[1] <= b.max[1] &&
    p[2] >= b.min[2] && p[2] <= b.max[2]
  );
}

export function boundsIntersects(a: Bounds3D, b: Bounds3D): boolean {
  if (isEmptyBounds(a) || isEmptyBounds(b)) return false;
  return (
    a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
  );
}

/** Expand by `distance` on every axis (negative values shrink). */
export function expandBounds(b: Bounds3D, distance: number): Bounds3D {
  if (isEmptyBounds(b)) return { min: [...EMPTY_BOUNDS.min], max: [...EMPTY_BOUNDS.max] };
  return {
    min: [b.min[0] - distance, b.min[1] - distance, b.min[2] - distance],
    max: [b.max[0] + distance, b.max[1] + distance, b.max[2] + distance],
  };
}

/** Compute tight bounds over an interleaved XYZ buffer (`stride` floats per point). */
export function boundsFromPositions(positions: Float32Array | Float64Array, pointCount: number, stride = 3): Bounds3D {
  const b: Bounds3D = { min: [...EMPTY_BOUNDS.min], max: [...EMPTY_BOUNDS.max] };
  const n = Math.min(pointCount, Math.floor(positions.length / stride));
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    for (let k = 0; k < 3; k++) {
      const v = positions[o + k];
      if (v < b.min[k]) b.min[k] = v;
      if (v > b.max[k]) b.max[k] = v;
    }
  }
  return b;
}

export function boundsEquals(a: Bounds3D, b: Bounds3D): boolean {
  return a.min.every((v, i) => v === b.min[i]) && a.max.every((v, i) => v === b.max[i]);
}
