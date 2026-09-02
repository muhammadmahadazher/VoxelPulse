/** `.vxp` project file serialization (ADR-0004, extended in Phase 2 §76–78):
 *  versioned JSON, references-only — never embeds point data. v2 adds the
 *  project dataset table; v1 files migrate losslessly (layers keep their
 *  inline metadata, synthetic layers simply have no datasetId). */
import {
  useProjectStore, newProjectMeta,
  type Layer, type ProjectDatasetRef, type ProjectMeta,
} from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";

export interface VxpCamera { position: [number, number, number]; target: [number, number, number] }
export interface VxpProject {
  formatVersion: 2;
  meta: ProjectMeta;
  datasets: ProjectDatasetRef[];
  layers: Layer[];
  layout: { left: number; right: number; bottom: number };
  workspace: { type: "scene"; viewLayout: string; camera: VxpCamera | null };
}

export function serializeProject(camera: VxpCamera | null, viewLayout: string): VxpProject {
  const p = useProjectStore.getState();
  const ui = useUiStore.getState();
  return {
    formatVersion: 2,
    meta: p.meta,
    datasets: p.datasets.map((d) => ({ ...d })),
    layers: p.layers.map((l) => ({ ...l })),
    layout: { left: ui.layout.leftWidth, right: ui.layout.rightWidth, bottom: ui.layout.bottomHeight },
    workspace: { type: "scene", viewLayout, camera },
  };
}

/** Accept v1 and v2 documents (§76, §77): v1 projects migrate by gaining an
 *  empty dataset table — inline layer metadata keeps everything usable. */
export function deserializeProject(doc: unknown): VxpProject {
  const raw = doc as Partial<Omit<VxpProject, "formatVersion">> & { formatVersion?: number };
  if (!raw || !Array.isArray(raw.layers) || (raw.formatVersion !== 1 && raw.formatVersion !== 2)) {
    throw new Error("not a valid VoxelPulse project (expected formatVersion 1 or 2)");
  }
  return {
    formatVersion: 2,
    meta: { ...newProjectMeta(), ...raw.meta, formatVersion: 2 },
    datasets: (Array.isArray(raw.datasets) ? raw.datasets : []) as ProjectDatasetRef[],
    layers: (raw.layers as Layer[]).filter((l) => typeof l?.id === "string"),
    layout: { left: 264, right: 288, bottom: 176, ...raw.layout },
    workspace: {
      type: "scene",
      viewLayout: raw.workspace?.viewLayout ?? "single",
      camera: raw.workspace?.camera ?? null,
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
    open: true, meta: doc.meta, layers: doc.layers, datasets: doc.datasets,
    dirty: false, selection: { kind: "none" }, savedRef: doc.meta.name,
  });
  useUiStore.getState().setLayout({
    leftWidth: doc.layout.left, rightWidth: doc.layout.right, bottomHeight: doc.layout.bottom,
  });
  void p;
  return { camera: doc.workspace.camera, viewLayout: doc.workspace.viewLayout };
}
