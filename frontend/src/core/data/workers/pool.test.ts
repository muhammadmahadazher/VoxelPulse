import { describe, it, expect } from "vitest";
import { WorkerPool, type PoolWorker } from "./pool";
import type { WorkerJob, WorkerResponse, JobPriority } from "./protocol";

/** Scriptable fake worker: echoes a decode "result" after a delay, or can
 *  crash / go silent / record posts for transfer-list assertions. */
function fakeWorker(opts?: {
  crash?: boolean;
  drop?: boolean;
  delayMs?: number;
  posts?: Array<{ transfer?: Transferable[]; job: WorkerJob }>;
  onEcho?: (job: WorkerJob) => void;
}): PoolWorker {
  const w: PoolWorker = {
    postMessage(msg, transfer) {
      const job = msg as WorkerJob;
      opts?.posts?.push({ transfer, job });
      if (opts?.crash) {
        setTimeout(() => w.onerror?.({ message: "boom" }), 5);
        return;
      }
      if (opts?.drop) return;
      setTimeout(() => {
        opts?.onEcho?.(job);
        w.onmessage?.({
          data: {
            type: "result",
            id: job.id,
            pointCount: 0,
            positions: new ArrayBuffer(job.payload.buffer.byteLength),
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            transfers: 1,
          } as WorkerResponse,
        });
      }, opts?.delayMs ?? 5);
    },
    terminate() { /* noop */ },
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  return w;
}

const job = (priority: JobPriority = "normal", bytes = 8) => ({
  type: "decode" as const,
  priority,
  payload: { format: "xyz", buffer: new ArrayBuffer(bytes) },
});

describe("WorkerPool", () => {
  it("runs a job and returns the result", async () => {
    const pool = new WorkerPool({ spawn: () => fakeWorker() });
    const r = await pool.run(job(), { extract: (x) => x });
    expect(r.type).toBe("result");
    pool.dispose();
  });

  it("runs concurrent jobs through a bounded worker set", async () => {
    let spawned = 0;
    const pool = new WorkerPool({
      spawn: () => (spawned++, fakeWorker({ delayMs: 15 })),
      maxWorkers: 2,
    });
    await Promise.all(Array.from({ length: 6 }, () => pool.run(job(), { extract: (x) => x })));
    expect(spawned).toBeLessThanOrEqual(2);
    pool.dispose();
  });

  it("drains the queue by priority after the active job (§43)", async () => {
    const seen: JobPriority[] = [];
    const pool = new WorkerPool({
      maxWorkers: 1,
      spawn: () => fakeWorker({ delayMs: 8, onEcho: (j) => seen.push(j.priority) }),
    });
    // First run takes the single worker; the rest queue synchronously in order.
    const first = pool.run(job("background"), { extract: (x) => x });
    const rest = (["normal", "critical", "background", "interactive"] as const)
      .map((p) => pool.run(job(p), { extract: (x) => x }));
    await first;
    await Promise.all(rest);
    expect(seen).toEqual(["background", "critical", "interactive", "normal", "background"]);
    pool.dispose();
  });

  it("cancels a queued job so it never emits a result (§64)", async () => {
    const ctrl = new AbortController();
    const pool = new WorkerPool({ maxWorkers: 1, spawn: () => fakeWorker({ delayMs: 20 }) });
    const blocker = pool.run(job(), { extract: (x) => x }); // occupies the worker
    const queued = pool.run(job(), { signal: ctrl.signal, extract: (x) => x });
    ctrl.abort();
    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
    await blocker;
    pool.dispose();
  });

  it("cancels an active job and drops its late result without throwing (§64)", async () => {
    const ctrl = new AbortController();
    const pool = new WorkerPool({ spawn: () => fakeWorker({ delayMs: 30 }) });
    const active = pool.run(job(), { signal: ctrl.signal, extract: (x) => x });
    ctrl.abort();
    await expect(active).rejects.toMatchObject({ code: "cancelled" });
    // Worker still replies at ~30ms; the pool must drop it silently.
    await new Promise((r) => setTimeout(r, 60));
    pool.dispose();
  });

  it("uses a transfer list for large payloads (§26)", async () => {
    const posts: Array<{ transfer?: Transferable[]; job: WorkerJob }> = [];
    const pool = new WorkerPool({ spawn: () => fakeWorker({ posts }) });
    await pool.run({ type: "decode", priority: "normal", payload: { format: "xyz", buffer: new ArrayBuffer(1 << 20) } }, {
      extract: (x) => x,
    });
    expect(posts[0]?.transfer).toBeDefined();
    expect(posts[0]!.transfer!.length).toBeGreaterThanOrEqual(1);
    pool.dispose();
  });

  it("recovers after a worker crash — later jobs still succeed (§63)", async () => {
    let healthy = false;
    const pool = new WorkerPool({ spawn: () => fakeWorker({ crash: !healthy }) });
    const failed = await pool.run(job(), { extract: (x) => x }).catch((e) => e);
    expect(failed).toMatchObject({ code: "decode-failed" });
    healthy = true;
    const ok = await pool.run(job(), { extract: (x) => x });
    expect(ok.type).toBe("result");
    pool.dispose();
  });

  it("propagates worker error responses without killing the pool", async () => {
    let mode: "error" | "ok" = "error";
    const pool = new WorkerPool({
      spawn: () => {
        const w: PoolWorker = {
          postMessage(msg) {
            const j = msg as WorkerJob;
            setTimeout(() => {
              if (mode === "error") {
                w.onmessage?.({ data: { type: "error", id: j.id, code: "invalid-data", message: "bad header" } as WorkerResponse });
                mode = "ok";
              } else {
                w.onmessage?.({ data: { type: "result", id: j.id, pointCount: 0, positions: new ArrayBuffer(8), bounds: { min: [0, 0, 0], max: [0, 0, 0] }, transfers: 0 } as WorkerResponse });
              }
            }, 1);
          },
          terminate() {},
          onmessage: null,
          onerror: null,
          onmessageerror: null,
        };
        return w;
      },
    });
    await expect(pool.run(job(), { extract: (x) => x })).rejects.toMatchObject({ code: "invalid-data" });
    const ok = await pool.run(job(), { extract: (x) => x });
    expect(ok.type).toBe("result");
    pool.dispose();
  });

  it("dispose rejects queued work as cancelled", async () => {
    const pool = new WorkerPool({ maxWorkers: 1, spawn: () => fakeWorker({ delayMs: 25 }) });
    await pool.run(job(), { extract: (x) => x });
    const queued = pool.run(job(), { extract: (x) => x });
    pool.dispose();
    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
  });
});
