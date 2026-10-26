/** Worker job protocol (§25). Discriminated unions both directions so the
 *  pool and the worker share one compile-checked contract. */

export type JobPriority = "critical" | "interactive" | "normal" | "background";

export const PRIORITY_RANK: Record<JobPriority, number> = {
  critical: 3,
  interactive: 2,
  normal: 1,
  background: 0,
};

export type WorkerJobType = "decode" | "prepare-node";

export interface WorkerJob {
  id: string;
  type: WorkerJobType;
  priority: JobPriority;
  /** decode payload: format id + raw bytes (transferred, then owned by worker).
   *  prepare-node payload: node bytes + record layout + CRS/origin context
   *  (§36, §104) — the worker returns render-ready Float32 positions. */
  payload: {
    format: string;
    buffer: ArrayBuffer;
    // prepare-node extras:
    nodeId?: string;
    pointFormat?: number;
    pointRecordLength?: number;
    pointCount?: number;
    compressed?: boolean;
    scales?: [number, number, number];
    offsets?: [number, number, number];
    sourceProj?: string;
    targetProj?: string;
    origin?: [number, number, number];
  };
}

export interface PreparedNodePayload {
  nodeId: string;
  pointCount: number;
  positions: ArrayBuffer;          // render-space Float32 (origin-subtracted)
  positionsType: "f32";
  intensity?: ArrayBuffer;         // Float32 0..1
  colors?: ArrayBuffer;            // Uint8 ×3
  classification?: ArrayBuffer;    // Uint8
  worldBounds: { min: [number, number, number]; max: [number, number, number] };
}

export type WorkerResponse =
  | {
      type: "result";
      id: string;
      pointCount: number;
      positions: ArrayBuffer;
      /** Source precision flag — Float64 must survive the boundary (§87–89). */
      positionsType: "f32" | "f64";
      intensity?: ArrayBuffer;
      colors?: ArrayBuffer;
      classification?: ArrayBuffer;
      bounds: { min: [number, number, number]; max: [number, number, number] };
      transfers: number;
      /** prepare-node results carry the node id (§37). */
      nodeId?: string;
      worldBounds?: { min: [number, number, number]; max: [number, number, number] };
    }
  | { type: "error"; id: string; code: string; message: string; detail?: string }
  | { type: "cancelled"; id: string }
  | { type: "progress"; id: string; fraction: number; message?: string };
