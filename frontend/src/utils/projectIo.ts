/** `.vxp` project file serialization (ADR-0004): versioned JSON,
 *  references-only — never embeds point data. */
import {
  useProjectStore, newProjectMeta,
  type Layer, type ProjectMeta,
} from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";

export interface VxpCamera { position: [number, number, number]; target: [number, number, number] }
export interface VxpProject {
  formatVersion: 1;
  meta: ProjectMeta;
  layers: Layer[];
  layout: { left: number; right: number; bottom: number };
  workspace: { type: "scene"; viewLayout: string; camera: VxpCamera | null };
}

export function serializeProject(camera: VxpCamera | null, viewLayout: string): VxpProject {
  const p = useProjectStore.getState();
  const ui = useUiStore.getState();
  return {
    formatVersion: 1,
    meta: p.meta,
    layers: p.layers.map((l) => ({ ...l })),
    layout: { left: ui.layout.leftWidth, right: ui.layout.rightWidth, bottom: ui.layout.bottomHeight },
    workspace: { type: "scene", viewLayout, camera },
  };
}

export function deserializeProject(doc: unknown): VxpProject {
  const raw = doc as Partial<VxpProject>;
  if (!raw || raw.formatVersion !== 1 || !Array.isArray(raw.layers)) {
    throw new Error("not a valid VoxelPulse project (expected formatVersion 1)");
  }
  return {
    formatVersion: 1,
    meta: { ...newProjectMeta(), ...raw.meta, formatVersion: 1 },
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
    open: true, meta: doc.meta, layers: doc.layers, dirty: false,
    selection: { kind: "none" }, savedRef: doc.meta.name,
  });
  useUiStore.getState().setLayout({
    leftWidth: doc.layout.left, rightWidth: doc.layout.right, bottomHeight: doc.layout.bottom,
  });
  void p;
  return { camera: doc.workspace.camera, viewLayout: doc.workspace.viewLayout };
}
