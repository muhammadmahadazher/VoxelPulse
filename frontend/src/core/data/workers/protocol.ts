/** Worker job protocol (§25). Discriminated unions both directions so the
 *  pool and the worker share one compile-checked contract. */

export type JobPriority = "critical" | "interactive" | "normal" | "background";

export const PRIORITY_RANK: Record<JobPriority, number> = {
  critical: 3,
  interactive: 2,
  normal: 1,
  background: 0,
};

export type WorkerJobType = "decode";

export interface WorkerJob {
  id: string;
  type: WorkerJobType;
  priority: JobPriority;
  /** decode payload: format id + raw bytes (transferred, then owned by worker). */
  payload: { format: string; buffer: ArrayBuffer };
}

export type WorkerResponse =
  | {
      type: "result";
      id: string;
      pointCount: number;
      positions: ArrayBuffer;
      positionsByteOffset?: number;
      intensity?: ArrayBuffer;
      colors?: ArrayBuffer;
      classification?: ArrayBuffer;
      bounds: { min: [number, number, number]; max: [number, number, number] };
      transfers: number;
    }
  | { type: "error"; id: string; code: string; message: string; detail?: string }
  | { type: "cancelled"; id: string }
  | { type: "progress"; id: string; fraction: number; message?: string };
