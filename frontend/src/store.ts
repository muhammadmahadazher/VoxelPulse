import { create } from "zustand";

export type Colormap = "turbo" | "viridis" | "cyber";

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

interface VoxelState {
  connected: boolean;
  fps: number;
  latencyMs: number;
  frameCount: number;
  lastFrame: FrameData | null;

  // layers
  showGround: boolean;
  showBoxes: boolean;
  showClusters: boolean;
  pointSize: number;
  colormap: Colormap;
  intensityMin: number;
  paused: boolean;
  toggle: (k: "showGround" | "showBoxes" | "showClusters" | "paused") => void;
  setPoint: (v: number) => void;
  setColormap: (c: Colormap) => void;
  setIntensity: (v: number) => void;
  setStats: (fps: number, latency: number) => void;
  setFrame: (f: FrameData) => void;
  setConnected: (c: boolean) => void;
}

export const useStore = create<VoxelState>((set) => ({
  connected: false,
  fps: 0,
  latencyMs: 0,
  frameCount: 0,
  lastFrame: null,
  showGround: true,
  showBoxes: true,
  showClusters: false,
  pointSize: 2.0,
  colormap: "turbo",
  intensityMin: 0,
  paused: false,
  toggle: (k) => set((s) => ({ [k]: !s[k] }) as never),
  setPoint: (v) => set({ pointSize: v }),
  setColormap: (c) => set({ colormap: c }),
  setIntensity: (v) => set({ intensityMin: v }),
  setStats: (fps, latency) => set({ fps, latencyMs: latency }),
  setFrame: (f) =>
    set((s) => ({ lastFrame: f, frameCount: s.frameCount + 1 })),
  setConnected: (c) => set({ connected: c }),
}));
