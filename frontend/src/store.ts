import { create } from "zustand";

export type Colormap =
  | "neon" | "turbo" | "viridis" | "magma" | "infrared" | "height" | "class" | "zones";
export const COLORMAPS: Colormap[] = [
  "neon", "turbo", "viridis", "magma", "infrared", "height", "class", "zones",
];

export type StreamMode = "connecting" | "live" | "sim" | "file";
export type ScenarioName = "urban" | "warehouse" | "drone";
export type PipMode = "front" | "rear" | "bev";
export type ViewLayout = "single" | "split" | "fusion";

export interface SensorObject {
  id: number;
  label: string;
  conf: number;
  box: [number, number, number, number, number, number, number]; // x,y,z,dx,dy,dz,yaw
}

export interface Object2D {
  id: number; label: string; conf: number;
  u: number; v: number; w: number; h: number;
}

export interface FrameData {
  n: number;
  ts: number;
  objects: SensorObject[];
  objects2d: Object2D[];
  positions: Float32Array;
  intensity: Float32Array;
  camW: number; camH: number;
  camRGB: Uint8Array;
}

export const EMPTY_FRAME: FrameData = {
  n: 0, ts: 0, objects: [], objects2d: [],
  positions: new Float32Array(0), intensity: new Float32Array(0),
  camW: 0, camH: 0, camRGB: new Uint8Array(0),
};

export interface InspectPoint {
  x: number; y: number; z: number;
  range: number; intensity: number; // intensity 0..1
}

export interface RoiBounds {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}
export const DEFAULT_ROI: RoiBounds = {
  xMin: -80, xMax: 80, yMin: -40, yMax: 40, zMin: -3, zMax: 40,
};

export interface StatSample { t: number; fps: number; latency: number; points: number; tracks: number; density: number }

const HISTORY_LEN = 150;      // buffered telemetry frames (sampled)
const STATS_LEN = 120;        // time-series samples

interface VoxelState {
  mode: StreamMode;
  scenario: ScenarioName;
  connected: boolean;
  fps: number;
  latencyMs: number;
  frameCount: number;
  lastFrame: FrameData | null;

  // studio layout
  viewLayout: ViewLayout;
  paletteOpen: boolean;

  // layers
  showPoints: boolean;
  showGround: boolean;
  showBoxes: boolean;
  showRadar: boolean;
  showPostFx: boolean;
  showEdl: boolean;
  showDensity: boolean;
  showCropGizmo: boolean;
  pointSize: number;
  colormap: Colormap;
  intensityMin: number;
  paused: boolean;
  roi: RoiBounds;

  // tools
  rulerActive: boolean;
  rulerPoints: [number, number, number][];
  inspectEnabled: boolean;
  inspectPoint: InspectPoint | null;
  selectedTrack: number | null;

  // timeline
  history: FrameData[];
  scrub: { active: boolean; index: number };
  playSpeed: number; // 0.25 .. 4
  stats: StatSample[];

  // pip
  pipMode: PipMode;
  pipLarge: boolean;

  toggle: (k: "showPoints" | "showGround" | "showBoxes" | "showRadar" | "showPostFx" | "showEdl" | "showDensity" | "showCropGizmo" | "paused" | "rulerActive" | "inspectEnabled" | "paletteOpen" | "pipLarge") => void;
  setPoint: (v: number) => void;
  setColormap: (c: Colormap) => void;
  cycleColormap: () => void;
  setIntensity: (v: number) => void;
  setStats: (fps: number, latency: number) => void;
  setFrame: (f: FrameData) => void;
  pushHistory: (f: FrameData) => void;
  setConnected: (c: boolean) => void;
  setMode: (m: StreamMode) => void;
  setScenario: (s: ScenarioName) => void;
  setViewLayout: (v: ViewLayout) => void;
  cycleViewLayout: () => void;
  addRulerPoint: (p: [number, number, number]) => void;
  clearRuler: () => void;
  setInspect: (p: InspectPoint | null) => void;
  selectTrack: (id: number | null) => void;
  setRoi: (r: Partial<RoiBounds>) => void;
  resetRoi: () => void;
  setScrub: (active: boolean, index: number) => void;
  setPlaySpeed: (s: number) => void;
  setPipMode: (m: PipMode) => void;
  /** Frame the viewport should currently render (live or scrubbed). */
  displayFrame: () => FrameData;
}

export const useStore = create<VoxelState>((set, get) => ({
  mode: "connecting",
  scenario: "urban",
  connected: false,
  fps: 0,
  latencyMs: 0,
  frameCount: 0,
  lastFrame: null,

  viewLayout: "single",
  paletteOpen: false,

  showPoints: true,
  showGround: true,
  showBoxes: true,
  showRadar: true,
  showPostFx: true,
  showEdl: true,
  showDensity: false,
  showCropGizmo: false,
  pointSize: 2.4,
  colormap: "neon",
  intensityMin: 0,
  paused: false,
  roi: { ...DEFAULT_ROI },

  rulerActive: false,
  rulerPoints: [],
  inspectEnabled: true,
  inspectPoint: null,
  selectedTrack: null,

  history: [],
  scrub: { active: false, index: 0 },
  playSpeed: 1,
  stats: [],

  pipMode: "front",
  pipLarge: false,

  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<VoxelState>),
  setPoint: (v) => set({ pointSize: v }),
  setColormap: (c) => set({ colormap: c }),
  cycleColormap: () =>
    set((s) => ({ colormap: COLORMAPS[(COLORMAPS.indexOf(s.colormap) + 1) % COLORMAPS.length] })),
  setIntensity: (v) => set({ intensityMin: v }),
  setStats: (fps, latency) =>
    set((s) => {
      const f = s.lastFrame;
      const sample: StatSample = {
        t: Date.now(), fps, latency, points: f?.n ?? 0, tracks: f?.objects.length ?? 0,
        density: f && f.n ? f.n / 25000 : 0,
      };
      return { fps, latencyMs: latency, stats: [...s.stats.slice(-(STATS_LEN - 1)), sample] };
    }),
  setFrame: (f) => set((s) => ({ lastFrame: f, frameCount: s.frameCount + 1 })),
  pushHistory: (f) =>
    set((s) => ({
      history: s.scrub.active ? s.history : [...s.history.slice(-(HISTORY_LEN - 1)), f],
    })),
  setConnected: (c) => set({ connected: c }),
  setMode: (m) => set({ mode: m }),
  setScenario: (s) => set({ scenario: s }),
  setViewLayout: (v) => set({ viewLayout: v }),
  cycleViewLayout: () =>
    set((s) => ({
      viewLayout: s.viewLayout === "single" ? "split" : s.viewLayout === "split" ? "fusion" : "single",
    })),
  addRulerPoint: (p) =>
    set((st) => ({ rulerPoints: st.rulerPoints.length >= 2 ? [p] : [...st.rulerPoints, p] })),
  clearRuler: () => set({ rulerPoints: [] }),
  setInspect: (p) => set({ inspectPoint: p }),
  selectTrack: (id) => set({ selectedTrack: id }),
  setRoi: (r) => set((s) => ({ roi: { ...s.roi, ...r } })),
  resetRoi: () => set({ roi: { ...DEFAULT_ROI } }),
  setScrub: (active, index) =>
    set((s) => ({
      scrub: { active, index: Math.max(0, Math.min(index, s.history.length - 1)) },
      paused: active ? true : s.paused,
    })),
  setPlaySpeed: (speed) => set({ playSpeed: Math.max(0.25, Math.min(4, speed)) }),
  setPipMode: (m) => set({ pipMode: m }),
  displayFrame: () => {
    const s = get();
    if (s.scrub.active && s.history.length > 0)
      return s.history[Math.min(s.scrub.index, s.history.length - 1)] ?? s.lastFrame ?? EMPTY_FRAME;
    return s.lastFrame ?? EMPTY_FRAME;
  },
}));

const PREV_BOXES: Record<number, [number, number]> = {};
export const OBJECT_VELOCITIES: Record<number, [number, number]> = {};
/** Client-side velocity estimation per track id from consecutive frames. */
export function estimateVelocities(frame: FrameData): void {
  for (const o of frame.objects) {
    const prev = PREV_BOXES[o.id];
    if (prev) {
      OBJECT_VELOCITIES[o.id] = [
        (o.box[0] - prev[0]) * 30, (o.box[1] - prev[1]) * 30,
      ];
    } else {
      OBJECT_VELOCITIES[o.id] = [0, 0];
    }
    PREV_BOXES[o.id] = [o.box[0], o.box[1]];
  }
}
