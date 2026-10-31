/** `.vxp` project file serialization (ADR-0004, extended in Phase 2 §76–78
 *  and Phase 5 CP10): versioned JSON, references-only — never embeds point
 *  data, raster tiles, textures or terrain meshes. v2 adds the project
 *  dataset table; v3 gains an explicit project CRS; v4 adds raster display
 *  style + terrain state. v1 files migrate losslessly. */
import {
  useProjectStore, newProjectMeta,
  type Layer, type ProjectDatasetRef, type ProjectMeta,
} from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";
import { useStore } from "../store";
import { rasterRegistry } from "../core/raster/registry";
import type { RasterStyle } from "../core/raster/bands";

export interface VxpCamera { position: [number, number, number]; target: [number, number, number] }
export interface VxpProject {
  formatVersion: 4;
  meta: ProjectMeta;
  /** §45: project spatial reference, serialized as canonical id. */
  crs: string;
  datasets: ProjectDatasetRef[];
  layers: Layer[];
  layout: { left: number; right: number; bottom: number };
  workspace: {
    type: "scene"; viewLayout: string; camera: VxpCamera | null;
    /** §45: render origin used at save time — render-local camera values
     *  resolve to the same world coordinates after reload (§69). */
    renderOrigin?: readonly [number, number, number];
    /** CP10: terrain vertical exaggeration (visual only). */
    terrainExaggeration?: number;
  };
}

export function serializeProject(camera: VxpCamera | null, viewLayout: string, renderOrigin?: readonly [number, number, number]): VxpProject {
  const p = useProjectStore.getState();
  const ui = useUiStore.getState();
  const layers = p.layers.map((l) => {
    // CP10: raster display style is engine state — snapshot it onto the
    // layer record at save time (references only, no pixels)
    const rt = l.datasetId ? rasterRegistry.get(l.datasetId) : undefined;
    return rt?.style ? { ...l, rasterStyle: { ...rt.style } } : { ...l };
  });
  return {
    formatVersion: 4,
    meta: p.meta,
    crs: p.crs,
    datasets: p.datasets.map((d) => ({ ...d })),
    layers,
    layout: { left: ui.layout.leftWidth, right: ui.layout.rightWidth, bottom: ui.layout.bottomHeight },
    workspace: {
      type: "scene", viewLayout, camera, renderOrigin,
      terrainExaggeration: useStore.getState().terrainExaggeration,
    },
  };
}

/** Accept v1/v2/v3/v4 documents (§46, §76–77): older projects migrate
 *  forward — v2→v3 gains an explicit project CRS defaulting to LOCAL; v1
 *  additionally gains the empty dataset table; v4 raster style/terrain
 *  fields ride on layers/workspace and default honestly when absent. No
 *  user project may fail after an upgrade. */
export function deserializeProject(doc: unknown): VxpProject {
  const raw = doc as Partial<Omit<VxpProject, "formatVersion">> & { formatVersion?: number };
  if (!raw || !Array.isArray(raw.layers) || (raw.formatVersion !== 1 && raw.formatVersion !== 2 && raw.formatVersion !== 3 && raw.formatVersion !== 4)) {
    throw new Error("not a valid VoxelPulse project (expected formatVersion 1–4)");
  }
  return {
    formatVersion: 4,
    meta: { ...newProjectMeta(), ...raw.meta, formatVersion: 4 },
    crs: typeof raw.crs === "string" ? raw.crs : "VP:LOCAL", // v1/v2 → LOCAL (§46)
    datasets: (Array.isArray(raw.datasets) ? raw.datasets : []) as ProjectDatasetRef[],
    layers: (raw.layers as Layer[]).filter((l) => typeof l?.id === "string"),
    layout: { left: 264, right: 288, bottom: 176, ...raw.layout },
    workspace: {
      type: "scene",
      viewLayout: raw.workspace?.viewLayout ?? "single",
      camera: raw.workspace?.camera ?? null,
      renderOrigin: raw.workspace?.renderOrigin ?? undefined,
      terrainExaggeration: raw.workspace?.terrainExaggeration,
    },
  };
}

export function downloadProject(filename: string, doc: VxpProject): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".vxp") ? filename : `${filename}.vxp`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function saveAutosave(doc: VxpProject): void {
  try { localStorage.setItem("voxelpulse.autosave.v1", JSON.stringify(doc)); }
  catch { /* quota exceeded — autosave is best-effort */ }
}

export function loadAutosave(): VxpProject | null {
  try {
    const raw = localStorage.getItem("voxelpulse.autosave.v1");
    return raw ? deserializeProject(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Apply a deserialized project to the stores (returns camera/view to restore). */
export function applyProject(doc: VxpProject): { camera: VxpCamera | null; viewLayout: string } {
  const p = useProjectStore.getState();
  useProjectStore.setState({
    open: true, meta: doc.meta, crs: doc.crs, layers: doc.layers, datasets: doc.datasets,
    dirty: false, selection: { kind: "none" }, savedRef: doc.meta.name,
  });
  useUiStore.getState().setLayout({
    leftWidth: doc.layout.left, rightWidth: doc.layout.right, bottomHeight: doc.layout.bottom,
  });
  // CP10: restore terrain exaggeration (visual setting)
  if (typeof doc.workspace.terrainExaggeration === "number") {
    useStore.getState().setTerrainExaggeration(doc.workspace.terrainExaggeration);
  }
  return { camera: doc.workspace.camera, viewLayout: doc.workspace.viewLayout };
}
