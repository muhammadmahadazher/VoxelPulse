import { create } from "zustand";

export type Colormap =
  | "turbo" | "viridis" | "neon" | "infrared" | "height" | "velocity";
export const COLORMAPS: Colormap[] = ["neon", "turbo", "viridis", "infrared", "height", "velocity"];

export type StreamMode = "connecting" | "live" | "sim" | "file";
export type ScenarioName = "urban" | "warehouse" | "drone";
export type PipMode = "front" | "rear" | "bev";

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

interface VoxelState {
  mode: StreamMode;
  scenario: ScenarioName;
  connected: boolean;
  fps: number;
  latencyMs: number;
  frameCount: number;
  lastFrame: FrameData | null;

  // layers
  showGround: boolean;
  showBoxes: boolean;
  showRadar: boolean;
  showPostFx: boolean;
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
  paletteOpen: boolean;

  // pip
  pipMode: PipMode;
  pipLarge: boolean;

  toggle: (k: "showGround" | "showBoxes" | "showRadar" | "showPostFx" | "paused" | "rulerActive" | "inspectEnabled" | "paletteOpen" | "pipLarge") => void;
  setPoint: (v: number) => void;
  setColormap: (c: Colormap) => void;
  cycleColormap: () => void;
  setIntensity: (v: number) => void;
  setStats: (fps: number, latency: number) => void;
  setFrame: (f: FrameData) => void;
  setConnected: (c: boolean) => void;
  setMode: (m: StreamMode) => void;
  setScenario: (s: ScenarioName) => void;
  addRulerPoint: (p: [number, number, number]) => void;
  clearRuler: () => void;
  setInspect: (p: InspectPoint | null) => void;
  setRoi: (r: Partial<RoiBounds>) => void;
  resetRoi: () => void;
  setPipMode: (m: PipMode) => void;
}

export const useStore = create<VoxelState>((set, get) => ({
  mode: "connecting",
  scenario: "urban",
  connected: false,
  fps: 0,
  latencyMs: 0,
  frameCount: 0,
  lastFrame: null,

  showGround: true,
  showBoxes: true,
  showRadar: true,
  showPostFx: true,
  pointSize: 2.4,
  colormap: "neon",
  intensityMin: 0,
  paused: false,
  roi: { ...DEFAULT_ROI },

  rulerActive: false,
  rulerPoints: [],
  inspectEnabled: true,
  inspectPoint: null,
  paletteOpen: false,

  pipMode: "front",
  pipLarge: false,

  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<VoxelState>),
  setPoint: (v) => set({ pointSize: v }),
  setColormap: (c) => set({ colormap: c }),
  cycleColormap: () =>
    set((s) => ({ colormap: COLORMAPS[(COLORMAPS.indexOf(s.colormap) + 1) % COLORMAPS.length] })),
  setIntensity: (v) => set({ intensityMin: v }),
  setStats: (fps, latency) => set({ fps, latencyMs: latency }),
  setFrame: (f) => set((s) => ({ lastFrame: f, frameCount: s.frameCount + 1 })),
  setConnected: (c) => set({ connected: c }),
  setMode: (m) => set({ mode: m }),
  setScenario: (s) => set({ scenario: s }),
  addRulerPoint: (p) =>
    set((st) => ({ rulerPoints: st.rulerPoints.length >= 2 ? [p] : [...st.rulerPoints, p] })),
  clearRuler: () => set({ rulerPoints: [] }),
  setInspect: (p) => set({ inspectPoint: p }),
  setRoi: (r) => set((s) => ({ roi: { ...s.roi, ...r } })),
  resetRoi: () => set({ roi: { ...DEFAULT_ROI } }),
  setPipMode: (m) => set({ pipMode: m }),
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
