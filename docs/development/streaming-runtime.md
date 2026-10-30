# The Streaming Runtime (developer guide)

`frontend/src/core/streaming/` implements the out-of-core point-cloud
engine (ADR-0008). Five pieces, each replaceable:

```
CopcHierarchy      lazy paged hierarchy over a DataSource
        ↓
LodScheduler       pure traversal: frustum + SSE + budget → render set + requests
        ↓
CopcStreamRuntime  request lifecycle: dedup, cancellation, prepare, eviction
        ↓
prepareInPlace     worker pipeline: LAZ decode + CRS + origin rebase (Float32)
        ↓
StreamingClouds    renderer bridge: one THREE.Points per node, shared material
```

## Node identity

Voxel keys (`level,x,y,z`) are the stable identifiers — never generate random
IDs for spatial nodes. Node bounds derive from the COPC root cube and the
key (`nodeBounds`), so bounds are always available before point data.

Real COPC files skip levels: a leaf may sit at level 3 with no level-1/2
ancestors in the hierarchy. `discoverChildren` adopts the nearest deeper
descendant per octant so traversal always reaches the data.

## Lifecycle

1. **Open**: header (64 KB window) + info VLR — no point data.
2. **update(camera, viewProj)**: scheduler traversal → render set + node
   requests + hierarchy-page requests. Called at ~10 Hz from the renderer,
   never per frame per node.
3. **Request**: fetch (AbortSignal) → worker prepare (transferables) →
   `onNodeReady(nodeId, prepared)`.
4. **Evict**: visibility-aware (never-rendered first, then oldest, then
   high-detail) under prepared/bytes budgets. Pinned nodes survive.
5. **Dispose**: abort in-flight, release everything (`streamingRegistry
   .remove` from the layer-removal path).

## Rules

- **The scheduler is pure** — no THREE, no fetch, no React. Tests construct
  trees directly (`scheduler.test.ts`).
- **Heavy runtime objects stay out of React** (ADR-0003/0005). The renderer
  reads `preparedNodes()` imperatively; React sees only throttled metrics.
- **Never transfer a buffer you need back** — postMessage detaches it. The
  pool gets a copy; the runtime keeps the compressed cache.
- **COPC octrees skip levels** — per-octant descendant adoption is mandatory.
- **CRS + origin rebase happen in the worker** (§36): the main thread never
  touches source-scale Float64 positions for streamed nodes.
- **Page resolution**: a hierarchy page is owned by pointCount −1 entries;
  data nodes (pointCount ≥ 0) are not page owners. Rendered leaves keep
  requesting their page so subtrees discover after first paint.

## Debugging

`window.__vpStreaming` exposes live runtimes; `rt.debugTraversal(camera,
viewProj)` returns the full traversal intermediate, `rt.updateCount` the
scheduler cadence. Set `localStorage.voxelpulse.debug = "debug"` for
hierarchy/prepare logs.

## Adding diagnostics

Metrics flow through `registry.publishMetrics` → status bar
(useSyncExternalStore, throttled). Keep per-frame values out of React.
