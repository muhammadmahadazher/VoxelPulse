/** Orthophoto draping (CP8): sample a georeferenced imagery raster onto DEM
 *  terrain vertices — different dimensions/resolutions/extents work through
 *  each raster's OWN affine; a different imagery CRS transforms per-vertex
 *  through the cached proj4 pipeline (never guessed offsets). Imagery that
 *  cannot be placed honestly (UNKNOWN CRS, transform failure) is NOT draped
 *  — the user is warned, the terrain keeps its base shading. */
import type { TerrainMeshData } from "./terrain";
import type { RasterDescriptor } from "./model";
import { worldToPixel } from "./transform";
import { transformPoint } from "../spatial/transform";
import { spatialReferenceRegistry } from "../spatial/registry";

export interface DrapeInput {
  mesh: TerrainMeshData;
  origin: [number, number, number];
  /** Project CRS id (the DEM's display space). */
  projectCrsId: string;
  ortho: {
    desc: RasterDescriptor;
    samplePixel: (col: number, row: number) => { values: number[] } | null;
  };
}

export interface DrapeResult {
  /** RGB per vertex (0..1), same vertex order as mesh.positions. */
  colors: Float32Array;
  /** Non-fatal issues (UNKNOWN CRS, out-of-extent vertices) for the console. */
  warns: string[];
}

const BASE_GRAY: [number, number, number] = [0.42, 0.45, 0.48];

/** Vertex colors for one terrain tile. Never throws — problems become warns
 *  and base-gray vertices. */
export function drapeVertexColors(input: DrapeInput): DrapeResult {
  const { mesh, origin, projectCrsId, ortho } = input;
  const { desc } = ortho;
  const n = mesh.vertexCount;
  const colors = new Float32Array(n * 3);
  const warns: string[] = [];

  const sameCrs = desc.crs === projectCrsId;
  let toOrtho: ((e: number, nn: number) => [number, number]);
  if (sameCrs) {
    toOrtho = (e, nn) => [e, nn];
  } else {
    try {
      const projectRef = spatialReferenceRegistry.resolve(projectCrsId);
      const orthoRef = spatialReferenceRegistry.resolve(desc.crs);
      // compile the transform once up front; failure → honest warn, no drape
      transformPoint([origin[0], origin[1], 0], projectRef, orthoRef);
      toOrtho = (e, nn) => {
        const p = transformPoint([e, nn, 0], projectRef, orthoRef);
        return [p[0], p[1]];
      };
    } catch (e) {
      warns.push(`imagery CRS "${desc.crs}" is not transformable from the project CRS — imagery not draped (${(e as Error).message.slice(0, 80)})`);
      return { colors: new Float32Array(0), warns };
    }
  }

  let outOfExtent = 0;
  let notResident = 0;
  for (let i = 0; i < n; i++) {
    const e = mesh.positions[i * 3] + origin[0];
    const nn = mesh.positions[i * 3 + 1] + origin[1];
    const [oe, on] = toOrtho(e, nn);
    const [col, row] = worldToPixel(desc.geotransform, oe, on);
    const ci = Math.floor(col), ri = Math.floor(row);
    if (ci < 0 || ri < 0 || ci >= desc.width || ri >= desc.height) {
      outOfExtent++;
      colors[i * 3] = BASE_GRAY[0];
      colors[i * 3 + 1] = BASE_GRAY[1];
      colors[i * 3 + 2] = BASE_GRAY[2];
      continue;
    }
    const s = ortho.samplePixel(ci, ri);
    if (!s) {
      notResident++;
      colors[i * 3] = BASE_GRAY[0];
      colors[i * 3 + 1] = BASE_GRAY[1];
      colors[i * 3 + 2] = BASE_GRAY[2];
      continue;
    }
    colors[i * 3] = clamp01(s.values[0] / 255);
    colors[i * 3 + 1] = clamp01(s.values[1] / 255);
    colors[i * 3 + 2] = clamp01(s.values[2] / 255);
  }
  if (outOfExtent > 0) {
    warns.push(`${outOfExtent}/${n} terrain vertices fall outside the imagery extent (base shading kept)`);
  }
  if (notResident > 0) {
    warns.push(`${notResident}/${n} imagery tiles not resident during drape (base shading kept)`);
  }
  return { colors, warns };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}