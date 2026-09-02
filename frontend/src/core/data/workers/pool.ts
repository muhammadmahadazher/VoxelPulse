/** Bounded worker pool (§24, §26, §43). One shared pool — never one worker
 *  per parse. Priority queue, AbortSignal cancellation, transferable buffers,
 *  structured errors, and respawn-on-crash so one failed job cannot poison
 *  later imports (§63). The worker implementation is injected for tests. */
import { newJobId } from "../ids";
import { cancellationError, toVpDataError, VpDataError } from "../errors";
import { createLogger } from "../logging";
import type { JobPriority, WorkerJob, WorkerResponse } from "./protocol";
import { PRIORITY_RANK } from "./protocol";

const log = createLogger("worker-pool");

/** Minimal surface of `Worker` the pool touches (injectable in tests). */
export interface PoolWorker {
  postMessage(message: WorkerJob, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerResponse }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface PoolOptions {
  spawn?: () => PoolWorker;
  /** Upper bound on concurrent workers regardless of hardware (§24). */
  maxWorkers?: number;
}

interface Waiter {
  job: WorkerJob;
  resolve: (r: WorkerResponse) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort: () => void;
}

const DEFAULT_MAX_WORKERS = 4;

export class WorkerPool {
  readonly maxWorkers: number;
  private spawn: () => PoolWorker;
  private idle: PoolWorker[] = [];
  private busy = new Map<PoolWorker, Waiter>();
  private queue: Waiter[] = [];
  private disposed = false;

  constructor(opts?: PoolOptions) {
    this.spawn = opts?.spawn ?? defaultSpawn;
    this.maxWorkers = Math.max(1, Math.min(opts?.maxWorkers ?? DEFAULT_MAX_WORKERS, 8));
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.busy.size;
  }

  get workerCount(): number {
    return this.idle.length + this.busy.size;
  }

  /** Run a decode job. Large payloads travel via transfer list (§26). */
  run<T>(job: Omit<WorkerJob, "id">, opts: {
    signal?: AbortSignal;
    extract: (r: WorkerResponse & { type: "result" }) => T;
  }): Promise<T> {
    if (this.disposed) return Promise.reject(cancellationError("pool disposed"));
    const signal = opts.signal;
    if (signal?.aborted) return Promise.reject(cancellationError());
    const full: WorkerJob = { ...job, id: newJobId() };
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        job: full,
        resolve: (r) => resolve(opts.extract(r as WorkerResponse & { type: "result" })),
        reject,
        signal,
        onAbort: () => {
          this.removeQueued(full.id);
          reject(cancellationError());
          // Active job: tell the worker; its (already-decoded) reply is dropped.
          for (const [worker, w] of this.busy) {
            if (w.job.id === full.id) {
              try {
                worker.postMessage({ ...full, payload: { format: "cancel-notice", buffer: new ArrayBuffer(0) } } as WorkerJob);
              } catch { /* worker died; error path handles */ }
            }
          }
        },
      };
      if (signal) signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.queue.push(waiter);
      this.drain();
    });
  }

  private removeQueued(id: string): void {
    const i = this.queue.findIndex((w) => w.job.id === id);
    if (i >= 0) {
      const [w] = this.queue.splice(i, 1);
      w.signal?.removeEventListener("abort", w.onAbort);
    }
  }

  /** Start jobs on idle workers; spawn up to maxWorkers. Queue is priority-
   *  ordered (rank desc, then FIFO — §43). */
  private drain(): void {
    this.queue.sort((a, b) =>
      PRIORITY_RANK[b.job.priority] - PRIORITY_RANK[a.job.priority] ||
      a.job.id.localeCompare(b.job.id));
    while (this.queue.length) {
      const worker = this.takeWorker();
      if (!worker) {
        // No worker available at all (spawn keeps failing) — fail queued jobs
        // instead of leaving them pending forever.
        if (this.workerCount === 0 && this.busy.size === 0) {
          const stuck = this.queue.splice(0);
          for (const waiter of stuck) {
            this.fail(waiter, new VpDataError("decode-failed", "Worker pool could not start a worker", {
              detail: "decoding will fall back to the main thread",
            }));
          }
        }
        return;
      }
      const waiter = this.queue.shift()!;
      this.busy.set(worker, waiter);
      try {
        // Transfer the payload buffer — the worker takes ownership (§26).
        worker.postMessage(waiter.job, [waiter.job.payload.buffer]);
      } catch (e) {
        this.busy.delete(worker);
        this.fail(waiter, toVpDataError(e, "decode-failed", "Worker post failed"));
        this.retire(worker);
        continue;
      }
    }
  }

  private takeWorker(): PoolWorker | null {
    const idle = this.idle.pop();
    if (idle) return idle;
    if (this.workerCount < this.maxWorkers) {
      try {
        const w = this.spawn();
        w.onmessage = (e) => this.onMessage(w, e.data);
        w.onerror = (e) => this.onWorkerError(w, e);
        w.onmessageerror = () => this.onWorkerError(w, { message: "message serialization failed" });
        return w;
      } catch (e) {
        log.warn("worker spawn failed", e);
        return null;
      }
    }
    return null;
  }

  private onMessage(worker: PoolWorker, msg: WorkerResponse): void {
    const waiter = this.busy.get(worker);
    if (!waiter) return; // late result after cancel — dropped by design (§64)
    if (msg.type === "result" || msg.type === "error" || msg.type === "cancelled") {
      this.busy.delete(worker);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (msg.type === "result") {
        waiter.resolve(msg);
        this.idle.push(worker);
      } else if (msg.type === "cancelled") {
        waiter.reject(cancellationError());
        this.idle.push(worker);
      } else {
        waiter.reject(new VpDataError(
          (msg.code as VpDataError["code"]) ?? "decode-failed",
          msg.message,
          { detail: msg.detail },
        ));
        this.retire(worker); // don't trust a worker that reported an error
      }
      this.drain();
    }
    // progress messages leave the job running
  }

  private onWorkerError(worker: PoolWorker, e: { message?: string }): void {
    const waiter = this.busy.get(worker);
    this.retire(worker, /* respawn */ true);
    if (waiter) {
      this.busy.delete(worker);
      this.fail(waiter, new VpDataError("decode-failed", `Worker crashed: ${e.message ?? "unknown"}`));
    }
    this.drain();
  }

  private fail(waiter: Waiter, error: unknown): void {
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiter.reject(error);
  }

  private retire(worker: PoolWorker, _respawn = false): void {
    try {
      worker.terminate();
    } catch { /* already gone */ }
    this.idle = this.idle.filter((w) => w !== worker);
    this.busy.delete(worker);
    // Next drain() spawns a fresh worker on demand — crash recovery (§63).
  }

  /** Terminate all workers; pending and queued jobs reject as cancelled. */
  dispose(): void {
    this.disposed = true;
    for (const w of [...this.idle, ...this.busy.keys()]) {
      try { w.terminate(); } catch { /* noop */ }
    }
    this.idle = [];
    const queued = this.queue;
    this.queue = [];
    for (const waiter of queued) this.fail(waiter, cancellationError());
    for (const waiter of this.busy.values()) this.fail(waiter, cancellationError());
    this.busy.clear();
  }
}

function defaultSpawn(): PoolWorker {
  if (typeof Worker === "undefined") {
    throw new Error("Worker unavailable (SSR/test environment)");
  }
  return new Worker(new URL("./decodeWorker.ts", import.meta.url), { type: "module" }) as unknown as PoolWorker;
}
