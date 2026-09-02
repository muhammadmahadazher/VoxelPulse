/** Project state: layers, selection, dirty flag, recent projects (ADR-0002/0004).
 *  Point data never lives here — only references and metadata. */
import { create } from "zustand";

export type LayerType =
  | "pointcloud" | "detections" | "camera" | "reference" | "group";

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  source: { kind: "demo" | "stream" | "file"; name: string } | null;
  /** Reference into the project dataset table (§35). Synthetic/reference
   *  layers (demo, detections, camera, reference frame) have none. */
  datasetId?: string;
  pointCount?: number;
  bounds?: [number, number, number, number, number, number]; // xmin ymin zmin xmax ymax zmax
}

/** Persistent dataset reference in project state (§35, §78) — descriptors
 *  only, never buffers. */
export interface ProjectDatasetRef {
  id: string;
  name: string;
  format: string;
  kind: string;
  source: Record<string, unknown>; // SourceDescriptor
  metadata: Record<string, unknown>; // serializable subset
}

export interface ProjectMeta {
  name: string;
  formatVersion: 2;
  created: string;
}

export type Selection =
  | { kind: "none" }
  | { kind: "layer"; id: string }
  | { kind: "track"; id: number }
  | { kind: "point"; x: number; y: number; z: number; range: number; intensity: number };

interface ProjectState {
  open: boolean;
  meta: ProjectMeta;
  layers: Layer[];
  datasets: ProjectDatasetRef[];
  selection: Selection;
  dirty: boolean;
  savedRef: string | null; // last Save As filename
  recents: string[];
  autosaveRef: string | null;

  newProject: () => void;
  closeProject: () => void;
  markSaved: (name: string | null) => void;
  addLayer: (l: Layer) => void;
  removeLayer: (id: string) => void;
  addDataset: (d: ProjectDatasetRef) => void;
  removeDataset: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  reorderLayer: (id: string, dir: -1 | 1) => void;
  select: (s: Selection) => void;
  setRecents: (r: string[]) => void;
}

const LS_RECENTS = "voxelpulse.recents.v1";

function loadRecents(): string[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_RECENTS) ?? "[]") as string[]; }
  catch { return []; }
}
function saveRecents(r: string[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_RECENTS, JSON.stringify(r.slice(0, 8)));
}

export const newProjectMeta = (name = "Untitled Project"): ProjectMeta => ({
  name, formatVersion: 2, created: new Date().toISOString(),
});

export const useProjectStore = create<ProjectState>((set, get) => ({
  open: false,
  meta: newProjectMeta(),
  layers: [],
  datasets: [],
  selection: { kind: "none" },
  dirty: false,
  savedRef: null,
  recents: loadRecents(),
  autosaveRef: null,

  newProject: () =>
    set({ open: true, meta: newProjectMeta(), layers: [], datasets: [], selection: { kind: "none" },
          dirty: false, savedRef: null, autosaveRef: null }),
  closeProject: () =>
    set({ open: false, layers: [], datasets: [], selection: { kind: "none" }, dirty: false, savedRef: null }),
  markSaved: (name) => {
    const recents = name ? [name, ...get().recents.filter((r) => r !== name)].slice(0, 8) : get().recents;
    saveRecents(recents);
    set({ dirty: false, savedRef: name ?? get().savedRef, recents });
  },
  addLayer: (l) =>
    set((s) => ({ layers: [...s.layers, l], dirty: true, selection: { kind: "layer", id: l.id } })),
  addDataset: (d) =>
    set((s) => ({ datasets: [...s.datasets.filter((x) => x.id !== d.id), d], dirty: true })),
  removeDataset: (id) =>
    set((s) => ({ datasets: s.datasets.filter((d) => d.id !== id) })),
  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      selection: s.selection.kind === "layer" && s.selection.id === id ? { kind: "none" } : s.selection,
      dirty: true,
    })),
  updateLayer: (id, patch) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), dirty: true })),
  reorderLayer: (id, dir) =>
    set((s) => {
      const i = s.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.layers.length) return {};
      const layers = [...s.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { layers, dirty: true };
    }),
  select: (selection) => set({ selection }),
  setRecents: (recents) => { saveRecents(recents); set({ recents }); },
}));
