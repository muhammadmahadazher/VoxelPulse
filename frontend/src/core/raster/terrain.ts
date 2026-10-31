/** Terrain mesh construction (CP6, §31-33): elevation samples → tiled 3D
 *  geometry. Pure and testable. Vertex world positions come from the full
 *  affine at PIXEL-CORNER indices (shared exactly between neighboring tiles
 *  — no seams); heights are RAW elevation values (never quantized — §26);
 *  nodata becomes a hole (triangles skipped, never zero-filled). Positions
 *  are origin-relative (Phase 3 precision strategy) in (E, N, Z) order —
 *  the same Z-up convention the point-cloud pipeline renders in. */
import type { GeoTransform } from "./transform";
import type { ScheduledTile } from "./tileScheduler";

export interface TerrainMeshData {
  /** Origin-relative (E−ox, N−oy, Z−oz), Float32. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Origin-relative AABB of VALID (non-nodata) vertices. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  vertexCount: number;
}

export interface TerrainBuildInput {
  decoded: {
    width: number;
    /** Buffer row stride in pixels — ≥ width when the decode included the
     *  +1 seam column/row (see runtime.loadTile). */
    bufWidth: number;
    height: number;
    samples: number;
    raw: Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
  };
  tile: ScheduledTile;
  gt: GeoTransform;
  origin: [number, number, number];
  /** Renderer applies mesh.scale.z = exaggeration; positions stay RAW. */
  maxVerticesPerSide?: number;
  nodata?: number;
}

/** Build one terrain tile mesh from a decoded raster tile. Returns null when
 *  the tile has no valid samples. */
export function buildTerrainTile(input: TerrainBuildInput): TerrainMeshData | null {
  const { decoded, tile, gt, origin, nodata } = input;
  const maxV = Math.max(2, input.maxVerticesPerSide ?? 32);
  const { width: tw, height: th, bufWidth: stride, samples, raw } = decoded;
  if (tw <= 0 || th <= 0 || samples <= 0) return null;

  // vertex grid: pixel-CORNER indices in the LEVEL's pixel space, from the
  // inclusive left/top edge to the inclusive right/bottom edge — corner
  // px[2] exists in BOTH this tile and its right neighbor (the runtime
  // decodes one extra column/row), so shared corners read the SAME source
  // pixel and neighboring meshes are exactly seamless.
  const stepX = Math.max(1, Math.ceil((tile.px[2] - tile.px[0]) / maxV));
  const stepY = Math.max(1, Math.ceil((tile.px[3] - tile.px[1]) / maxV));
  const cols: number[] = [];
  for (let c = tile.px[0]; c <= tile.px[2]; c += stepX) cols.push(c);
  if (cols[cols.length - 1] !== tile.px[2]) cols.push(tile.px[2]);
  const rows: number[] = [];
  for (let r = tile.px[1]; r <= tile.px[3]; r += stepY) rows.push(r);
  if (rows[rows.length - 1] !== tile.px[3]) rows.push(tile.px[3]);

  const nx = cols.length, ny = rows.length;
  if (nx < 2 || ny < 2) return null; // degenerate tile

  const f = tile.factor;
  const positions = new Float32Array(nx * ny * 3);
  const valid = new Uint8Array(nx * ny);
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const lc = cols[ix], lr = rows[iy];
      // world position via the full affine at full-res pixel CORNER
      const col = lc * f, row = lr * f;
      const wx = gt.a * col + gt.b * row + gt.c;
      const wy = gt.d * col + gt.e * row + gt.f;
      // height = RAW nearest sample at the corner's level pixel (clamped to
      // the decoded window; the +1 seam column keeps shared corners equal)
      const cc = Math.min(tw - 1, lc - tile.px[0]);
      const rr = Math.min(th - 1, lr - tile.px[1]);
      const v = Number(raw[(rr * stride + cc) * samples]);
      const i = iy * nx + ix;
      const has = nodata === undefined || !Number.isFinite(nodata) || v !== nodata;
      valid[i] = has ? 1 : 0;
      positions[i * 3] = wx - origin[0];
      positions[i * 3 + 1] = wy - origin[1];
      positions[i * 3 + 2] = v - origin[2];
      if (has) {
        if (wx - origin[0] < min[0]) min[0] = wx - origin[0];
        if (wy - origin[1] < min[1]) min[1] = wy - origin[1];
        if (v - origin[2] < min[2]) min[2] = v - origin[2];
        if (wx - origin[0] > max[0]) max[0] = wx - origin[0];
        if (wy - origin[1] > max[1]) max[1] = wy - origin[1];
        if (v - origin[2] > max[2]) max[2] = v - origin[2];
      }
    }
  }

  // triangles; any nodata corner → skipped (a hole, not a zero)
  const indices: number[] = [];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iy * nx + ix;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (valid[a] && valid[b] && valid[c]) indices.push(a, b, c);
      if (valid[b] && valid[d] && valid[c]) indices.push(b, d, c);
    }
  }

  return {
    positions,
    indices: new Uint32Array(indices),
    bounds: { min, max },
    vertexCount: nx * ny,
  };
}