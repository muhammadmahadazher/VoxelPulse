# ADR-0006: Worker & Resource Lifecycle

- Status: accepted (Phase 2)
- Date: 2026-09

## Context

Format decoding is CPU-heavy and untrusted-input-adjacent. Phase 1 parsed on
the main thread (UI froze on large files), allocated without accounting, and
had no story for cancellation or cleanup. The massive-data phase will need
prioritized, cancellable, bounded chunk work; Phase 2 must build that
foundation without speculative machinery (§24–26, §42–44).

## Decision

**One worker pool, injectable and observable.**

- `WorkerPool` keeps a bounded set of workers (spawn-on-demand, ≤ 4 by
  default, hard cap 8). Never one worker per parse (§24).
- Jobs are queued by priority (`critical > interactive > normal > background`,
  rank-ordered, FIFO within a rank). Future camera-driven chunk requests use
  `interactive`/`critical`; background prefetch uses `background` (§43).
- Large payloads travel as **transferables** — the pool transfers the payload
  buffer to the worker and the worker transfers decoded arrays back; a test
  asserts the transfer list is used (§26).
- **Cancellation** is an `AbortSignal` that propagates source → adapter →
  pool → worker. Queued jobs are removed; active jobs are rejected
  immediately and their late results are dropped by id (§31, §64). One test
  covers queued-cancel and one covers active-cancel.
- **Crash recovery**: a worker that throws/errs is terminated; its job fails
  with a structured `VpDataError`, and the next job spawns a fresh worker —
  one bad parser cannot poison the pool (§63). A test kills a worker mid-job
  and requires the next job to succeed.
- Where `Worker` is unavailable (SSR, unit tests), the client decodes
  in-place on the main thread — the pipeline behaves identically, just slower
  and blocking. This keeps the engine testable in plain Node.

**One resource manager, explicit lifecycle.**

- `ResourceManager` owns accounting for every runtime allocation: CPU decoded
  arrays, CPU source/cache bytes, and GPU estimates (labelled estimates —
  exact GPU memory is not observable) (§19, §21).
- States are enumerable: `created → loading → ready → evicted/disposed/error`.
  No hidden lifetimes (§20).
- A configurable CPU budget (default 256 MB) drives LRU eviction of `ready`
  CPU resources; GPU records are never auto-evicted by the manager — the
  renderer owns those (§22). Eviction uses a monotonic logical clock so LRU
  order is exact even for same-millisecond operations.
- Dataset removal releases that dataset's resources through the manager;
  layers take/ release dataset refs so a dataset with two layers survives
  removing one of them (§81–82, enforced in the app layer, not the store).

## Consequences

- Import of a 400k-point file keeps the main thread responsive (verified in
  Playwright: max rAF gap stays far below interaction-destroying levels).
- Memory growth is observable (`resourceManager.report()`), which powers the
  §61/§62 leak tests: 20 import/dispose cycles return the registry to
  baseline.
- Trade-off: the pool cannot currently *pause* an in-flight decode; cancellation
  of an active job still pays the decode cost once (result discarded). This is
  acceptable for chunk-sized work and documented rather than hidden.

## References

- ADR-0005 for where the pool sits in the pipeline
- `frontend/src/core/data/workers/pool.ts`, `.../resources/manager.ts`
