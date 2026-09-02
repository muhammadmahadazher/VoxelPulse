/** Observable job store (§30, §54, §95). Plain pub/sub — no React coupling
 *  in core; the UI subscribes through a tiny hook. Bounded history. */
import type { JobId } from "../ids";
import { newJobId } from "../ids";
import type { Job, JobStatus } from "./types";
import { isTerminalJob } from "./types";

const HISTORY_LIMIT = 12;

type Listener = (jobs: Job[]) => void;

export class JobStore {
  private jobs = new Map<JobId, Job>();
  private order: JobId[] = [];
  private listeners = new Set<Listener>();

  create(title: string, type: Job["type"] = "import"): Job {
    const job: Job = { id: newJobId(), type, title, status: "queued", startedAt: Date.now() };
    this.jobs.set(job.id, job);
    this.order.unshift(job.id);
    this.trim();
    this.emit();
    return job;
  }

  update(id: JobId, patch: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job || isTerminalJob(job.status)) return;
    Object.assign(job, patch);
    if (isTerminalJob(job.status)) job.completedAt = Date.now();
    this.emit();
  }

  setStatus(id: JobId, status: JobStatus, extra?: Partial<Job>): void {
    this.update(id, { status, ...extra });
  }

  get(id: JobId): Job | undefined {
    return this.jobs.get(id);
  }

  /** Newest first, bounded history (§95). */
  list(): Job[] {
    return this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  private trim(): void {
    while (this.order.length > HISTORY_LIMIT) {
      const oldest = this.order.pop()!;
      // Prefer trimming terminal jobs; a long-running job is never dropped.
      const job = this.jobs.get(oldest);
      if (!job || isTerminalJob(job.status)) this.jobs.delete(oldest);
      else this.order.unshift(this.order.pop()!);
    }
  }

  private emit(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

export const jobStore = new JobStore();
