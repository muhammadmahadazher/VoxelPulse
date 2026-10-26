# ADR-0008: Massive Point Cloud Streaming (COPC + LAZ)

- Status: accepted (Phase 4)
- Date: 2026-10

## Context

Phases 2–3 left point files as whole-file datasets: ≤ 400k points, 800 MB
guard. Phase 4 removes that ceiling via COPC — hierarchical random-access
LAZ — so that opening a multi-GB dataset never downloads or decodes more
than the visible fraction. Hard environment constraint: **CPU + integrated
graphics only** — no CUDA, no dedicated VRAM; Web Workers + WASM where
justified; WebGL renderer unchanged.

## Ecosystem evaluation (§4–5)

| Candidate | Purpose | License | Size | Maintenance | Verdict |
|---|---|---|---|---|---|
| **laz-perf** (npm `laz-perf` 0.0.7) | LAZ decompression as WASM (`createLazPerf()`, `ChunkDecoder.open(fmt, len, ptr)` + `getPoint`) | Apache-2.0 | ~200 KB wasm + glue | hobuinc, steady; npm Feb 2025 | **ADOPT** — the only serious browser LAZ decoder; chunk-level API matches COPC nodes exactly |
| copc.js (`copc` 0.0.9) | COPC header/hierarchy/node reading over a Getter abstraction | MIT | small | connormanning | **Decline** — its Getter/cross-fetch layer duplicates our `DataSource` byte-range abstraction; its decode path re-instantiates laz-perf modules (our §6 memory audit wants one module per worker). We reuse its validated offset layouts (verified against its source). |
| loaders.gl | LAS/COPC loaders, worker framework | MIT | large framework | maintained | **Decline** — adopting a framework to replace the existing data engine violates §5/§106 |
| Potree / Potree 2 | octree traversal, SSE, budgets | BSD-2 | n/a (architecture reference) | active | **Reference only** — its replacement-refinement + point-budget model informs our scheduler; no code adopted |
| @lazstream/core | laz-perf worker wrapper | — | small | young | **Decline** — we already own a worker pool with priorities/cancellation/transferables |

## Decision

1. **COPC metadata in-house.** Header, `copc` info VLR (160 B: center/halfsize/
   spacing @0–40, root hierarchy page @40–56), hierarchy pages (32-byte
   entries: VoxelKey i32×4, offset u64, byteSize i32, pointCount i32; −1 =
   child page) parsed directly over `DataSource.read(ByteRange)` — lazy pages,
   never the whole file (§13–14).
2. **laz-perf for decompression, one WASM module per worker** created once at
   worker start and reused for every node (§103); decode loop follows the
   validated malloc/HEAPU8/ChunkDecoder pattern with `finally`-freed pointers
   and `decoder.delete()`. Memory stress-tested (§6, §123).
3. **Worker-side full preparation (§36, §104):** node bytes → LAZ decode →
   CRS transform (proj4js in worker) → render-origin subtraction → Float32
   transferables. Main thread never touches source-scale coordinates.
4. **Scheduler (§16–28):** camera-driven traversal; a node refines when
   visible, its projected screen-space error exceeds target, children exist,
   and point/memory budgets permit. Replacement rendering — a parent stays
   visible until children cover it (§19). Priorities: critical (hole-avoiding
   coarse), interactive (near-camera refinement), normal, background.
   Stale requests cancelled via AbortSignal; in-flight dedup (§29–30).
5. **Renderer: multiple node BufferGeometries** with pooled Three.js
   disposal, engine-owned (zero React per node), monitor draw calls (§55–60).
6. **Budgets separated (§40–42):** compressed range cache / decoded cache /
   prepared render resources with visibility-aware eviction (pure LRU
   rejected — visible parents must not evict).
7. **No CUDA / no SharedArrayBuffer / no WebGPU requirement** (§7, §81, §148);
   WebGL2 stays primary.

## Consequences

- Dataset size decouples from client memory: metadata + visible nodes only.
- laz-perf supports LAZ point formats 0–10 — COPC files (formats 6–8) and
  ordinary LAZ both decode; ordinary LAZ remains whole-file-decoded
  (progressively, worker-side) with an honest "convert to COPC" note (§48–50).
- Remote requirement: HTTP Range/206 + CORS; explicit actionable errors
  otherwise — never a silent full download (§46, §96–97).
- 64-bit offsets: LAS/COPC offsets arrive as BigInt where the format says
  u64; validated within Number.MAX_SAFE_INTEGER before byte-range use (§143–145).

## References

- COPC 1.0 spec — copc.io
- laz-perf — hobuinc/laz-perf (Apache-2.0)
- Potree 2 — architecture reference for SSE/refinement
