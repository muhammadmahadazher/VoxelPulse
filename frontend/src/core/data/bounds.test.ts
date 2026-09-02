import { describe, it, expect } from "vitest";
import {
  EMPTY_BOUNDS, isEmptyBounds, unionBounds, boundsCenter, boundsSize, boundsDiagonal,
  boundsContains, boundsIntersects, expandBounds, boundsFromPositions, boundsEquals,
} from "./bounds";

const B = (min: [number, number, number], max: [number, number, number]) => ({ min, max });

describe("bounds utilities", () => {
  it("starts empty and detects emptiness", () => {
    expect(isEmptyBounds(EMPTY_BOUNDS)).toBe(true);
    expect(isEmptyBounds(B([0, 0, 0], [1, 1, 1]))).toBe(false);
    expect(boundsSize(EMPTY_BOUNDS)).toEqual([0, 0, 0]);
    expect(boundsCenter(EMPTY_BOUNDS)).toEqual([0, 0, 0]);
  });

  it("unions correctly including with empty", () => {
    const a = B([0, 0, 0], [1, 1, 1]);
    const b = B([2, -1, 0.5], [3, 4, 2]);
    expect(boundsEquals(unionBounds(a, b), B([0, -1, 0], [3, 4, 2]))).toBe(true);
    expect(boundsEquals(unionBounds(a, EMPTY_BOUNDS), a)).toBe(true);
    expect(boundsEquals(unionBounds(EMPTY_BOUNDS, EMPTY_BOUNDS), EMPTY_BOUNDS)).toBe(true);
  });

  it("computes center, size, diagonal", () => {
    const b = B([-1, -2, -3], [1, 2, 3]);
    expect(boundsCenter(b)).toEqual([0, 0, 0]);
    expect(boundsSize(b)).toEqual([2, 4, 6]);
    expect(boundsDiagonal(b)).toBeCloseTo(Math.hypot(2, 4, 6), 10);
  });

  it("contains and intersects", () => {
    const a = B([0, 0, 0], [10, 10, 10]);
    expect(boundsContains(a, [5, 5, 5])).toBe(true);
    expect(boundsContains(a, [10, 5, 5])).toBe(true); // inclusive max
    expect(boundsContains(a, [10.1, 5, 5])).toBe(false);
    expect(boundsContains(a, [-0.001, 5, 5])).toBe(false);
    expect(boundsIntersects(a, B([9, 9, 9], [20, 20, 20]))).toBe(true);
    expect(boundsIntersects(a, B([10.5, 0, 0], [11, 1, 1]))).toBe(false);
    expect(boundsIntersects(a, EMPTY_BOUNDS)).toBe(false);
  });

  it("expands symmetrically and shrinks", () => {
    const b = expandBounds(B([1, 1, 1], [2, 2, 2]), 1);
    expect(boundsEquals(b, B([0, 0, 0], [3, 3, 3]))).toBe(true);
    const s = expandBounds(B([0, 0, 0], [10, 10, 10]), -2);
    expect(boundsEquals(s, B([2, 2, 2], [8, 8, 8]))).toBe(true);
  });

  it("builds bounds from interleaved positions", () => {
    const pts = new Float32Array([
      1, 2, 3,
      -5, 7, 0.5,
      0, 0, 0,
    ]);
    const b = boundsFromPositions(pts, 3);
    expect(boundsEquals(b, B([-5, 0, 0], [1, 7, 3]))).toBe(true);
  });

  it("boundsFromPositions honors stride and clamps count", () => {
    // 4 floats per point: x y z padding
    const pts = new Float32Array([1, 1, 1, 99, 4, 4, 4, 99, 2, 2, 2, 99]);
    const b = boundsFromPositions(pts, 3, 4);
    expect(boundsEquals(b, B([1, 1, 1], [4, 4, 4]))).toBe(true);
    const empty = boundsFromPositions(new Float32Array(0), 0);
    expect(isEmptyBounds(empty)).toBe(true);
  });
});
