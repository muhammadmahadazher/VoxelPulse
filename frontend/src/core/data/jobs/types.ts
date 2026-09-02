/** Generic job foundation (§28–29). Imports use it today; future processing
 *  jobs reuse the same model without new plumbing. */
import type { JobId } from "../ids";

export type JobType = "import" | (string & {});

export type JobStatus =
  | "queued" | "probing" | "reading" | "decoding" | "creating-layer"
  | "completed" | "failed" | "cancelled";

/** Stage ordering for progress display. */
export const JOB_STAGES: JobStatus[] = [
  "queued", "probing", "reading", "decoding", "creating-layer", "completed",
];

export interface JobError {
  code: string;
  message: string;
  detail?: string;
}

export interface Job {
  id: JobId;
  type: JobType;
  title: string;
  status: JobStatus;
  /** 0..1 when meaningful — never a fake timer value (§94). */
  progress?: number;
  message?: string;
  startedAt?: number;
  completedAt?: number;
  error?: JobError;
}

export function isTerminalJob(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
