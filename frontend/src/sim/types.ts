export type ScenarioName = "urban" | "warehouse" | "drone";

export interface SimCommand {
  type: "init" | "scenario" | "points" | "pause" | "resume";
  n?: number;
  scenario?: ScenarioName;
}

export interface SimAgentMsg {
  id: number;
  label: string;
  conf: number;
  box: [number, number, number, number, number, number, number];
}

export interface SimFrameMsg {
  type: "frame";
  n: number;
  ts: number;
  positions: Float32Array;
  intensity: Float32Array;
  objects: SimAgentMsg[];
  objects2d: { id: number; label: string; conf: number; u: number; v: number; w: number; h: number }[];
  camW: number;
  camH: number;
  camRGB: Uint8Array;
}
