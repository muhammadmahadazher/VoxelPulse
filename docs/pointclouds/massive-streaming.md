# Massive Point Cloud Streaming

VoxelPulse streams large point clouds out-of-core: the browser downloads and
decodes only what the camera can currently use. Dataset size is decoupled
from client memory — a multi-gigabyte file uses the same bounded caches as a
small one.

## LAS / LAZ vs COPC

| | Ordinary LAS/LAZ | COPC (.copc.laz) |
|---|---|---|
| Structure | sequential points | LAZ 1.4 + spatial octree hierarchy |
| Random access | none (whole file) | byte-range per node |
| Streaming | ✗ (whole-file decode, worker-side, progressive UI) | ✓ node-by-node, camera-driven |
| Best for | small/medium files, conversion source | massive datasets, remote hosting |

A COPC file is a LAZ 1.4 file whose points are organized into octree nodes,
each addressable via a hierarchy page (byte offset + compressed size +
point count). VoxelPulse reads header + info VLR + hierarchy pages on
demand — never the whole file.

## How streaming works

```
Camera move
   → LOD scheduler (frustum cull · screen-space-error · point budget)
   → node requests (prioritized: critical → interactive → normal)
   → byte-range fetch (206 Partial Content)
   → worker: LAZ decode + CRS transform + render-origin rebase (Float32)
   → GPU (one THREE.Points per node)
```

- **Coarse first**: the root nodes arrive first; navigation never waits for
  full resolution.
- **No holes**: a parent stays visible until its children are ready
  (replacement refinement).
- **Point budget**: Auto / Efficiency / Balanced / Quality — the scheduler
  stops refining when the budget is spent.

## Remote server requirements

- HTTP(S) with `Range` / `206 Partial Content` support
- CORS headers allowing the VoxelPulse origin (`Access-Control-Allow-Origin`)
- No server-side VoxelPulse infrastructure required — GitHub Pages-hosted
  VoxelPulse can stream from any compliant COPC host (e.g. S3 + a static
  COPC file).

Errors are actionable: a host without range support reports
"This host does not support byte-range requests…" rather than downloading
gigabytes; CORS failures name the cause.

## Local COPC files

Local `.copc.laz` files stream too — `Blob.slice()` provides the same
byte-range access without a server.

## Integrated-graphics expectations

VoxelPulse is built for CPU + integrated graphics (no CUDA, no dedicated
VRAM required):

- decode and CRS preparation run in Web Workers (WASM laz-perf + proj4)
- point budgets keep draw load bounded; Adaptive-quality logic reduces the
  budget before touching analytical features like EDL
- memory plateaus around the configured budgets regardless of file size

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "This host does not support byte-range requests…" | The server ignores `Range`; host the file on a range-capable server. |
| CORS error naming the host | Add `Access-Control-Allow-Origin` for the VoxelPulse origin. |
| Slow refinement on remote data | Network latency; nodes stream progressively — navigate and let detail arrive. |
| Points look sparse when zoomed out | The point budget is doing its job; zoom in for detail or raise the budget. |

## For contributors

The streaming runtime lives in `frontend/src/core/streaming/` — see
[development/coordinate-spaces.md](../development/coordinate-spaces.md) for
the coordinate pipeline and ADR-0008 for the streaming architecture.
