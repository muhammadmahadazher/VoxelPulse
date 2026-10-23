/** Project-spatial service (§9, §17, §37–42, §66, §69): the app-layer bridge
 *  between the project CRS state and the renderer. Owns the stable
 *  RenderOrigin, prepares imported chunks for display (CRS transform →
 *  origin subtraction → Float32), and re-transforms the displayed layer when
 *  the project CRS changes. Lives OUTSIDE React state (§34). */
import { useProjectStore } from "../stores/projectStore";
import { datasetManager } from "../core/data/datasetManager";
import { spatialReferenceRegistry } from "../core/spatial/registry";
import { UNKNOWN_REFERENCE, LOCAL_REFERENCE, type SpatialReference } from "../core/spatial/reference";
import {
  prepareChunk, originFromBounds, unionWorldBounds,
  type RenderOrigin, type PreparedChunk,
} from "../core/spatial/coordinates";
import { loadStaticFrame } from "../ws";
import { chunkToFrame } from "./frameBridge";
import { appendConsole } from "../panels/BottomPanel";
import type { DecodedChunk } from "../core/data/formats/types";

interface ProjectSpatialState {
  origin: RenderOrigin | null;
  /** World bounds of the currently displayed static content (project CRS). */
  worldBounds: ReturnType<typeof unionWorldBounds>;
}

const state: ProjectSpatialState = { origin: null, worldBounds: null };

/** Current project CRS as a resolved SpatialReference (cached by registry). */
export function projectReference(): SpatialReference {
  const id = useProjectStore.getState().crs;
  if (id === "VP:LOCAL") return LOCAL_REFERENCE;
  try {
    return spatialReferenceRegistry.resolve(id);
  } catch {
    return UNKNOWN_REFERENCE;
  }
}

/** Dataset's source reference from its descriptor metadata (§10, §104). */
export function datasetReference(datasetId: string): SpatialReference {
  const d = datasetManager.descriptor(datasetId);
  const info = d?.metadata.spatialReference;
  if (!info) return UNKNOWN_REFERENCE;
  return info.reference;
}

export function renderOrigin(): RenderOrigin {
  if (!state.origin) state.origin = { world: [0, 0, 0] };
  return state.origin;
}

/** Stable project origin (§37): center of the first aligned content's world
 *  bounds; identity [0,0,0] while everything is LOCAL. NOT camera-driven —
 *  rebasing is future work (§38). */
function ensureOriginFrom(prep: PreparedChunk): void {
  if (state.origin) return;
  if (isAtIdentity(prep.worldBounds)) return; // keep 0,0,0 for LOCAL scenes
  state.origin = originFromBounds(prep.worldBounds);
}

function isAtIdentity(b: { min: number[]; max: number[] } | null): boolean {
  if (!b) return true;
  const m = Math.max(Math.abs(b.min[0]), Math.abs(b.min[1]), Math.abs(b.max[0]), Math.abs(b.max[1]));
  return m < 1e6; // local-scale scenes keep the zero origin
}

export interface DisplayResult {
  prepared: PreparedChunk;
  /** True when the dataset could not be transformed into project space (§73). */
  unaligned: boolean;
}

/** Decode + prepare a dataset chunk for display under the current project CRS. */
export async function displayChunk(datasetId: string): Promise<DisplayResult> {
  const chunk = await datasetManager.readChunk(datasetId, 0);
  const sourceRef = datasetReference(datasetId);
  const projectRef = projectReference();
  const unaligned =
    sourceRef.kind === "unknown" && projectRef.kind !== "local";
  const prepared = prepareChunk(chunk, {
    sourceRef,
    projectRef,
    origin: renderOrigin(),
  });
  ensureOriginFrom(prepared);
  state.worldBounds = unionWorldBounds([prepared.worldBounds].filter(Boolean) as never[]);
  return { prepared, unaligned };
}

/** Push a prepared chunk into the renderer's static frame path (§85 path). */
export function showPrepared(prepared: PreparedChunk, chunk: DecodedChunk, name: string): void {
  loadStaticFrame(
    {
      ...chunkToFrame(chunk),
      positions: prepared.positions,
    },
    name,
  );
}

/** §17, §74: re-transform the displayed static layer after a project CRS
 *  change — re-decodes through the dataset's still-open source (no stored
 *  duplicate positions, §85) and re-prepares under the new project CRS.
 *  LOCAL datasets and UNKNOWN datasets are loaded identity with a console
 *  note; no silent nonsense placement (§73). */
export async function retransformDisplayedLayer(): Promise<void> {
  const p = useProjectStore.getState();
  const layer = p.layers.find((l) => l.type === "pointcloud" && l.datasetId);
  if (!layer?.datasetId) return;
  const { prepared, unaligned } = await displayChunk(layer.datasetId);
  const chunk = await datasetManager.readChunk(layer.datasetId, 0);
  showPrepared(prepared, chunk, layer.name);
  if (unaligned) {
    appendConsole(`cannot align "${layer.name}" — its spatial reference is UNKNOWN (assign one via the layer menu)`);
  }
}

/** Test/diagnostic access. */
export function projectSpatialDebug() {
  return { origin: state.origin?.world ?? null, worldBounds: state.worldBounds };
}
