# ADR-0005: Spatial Data Engine

- Status: accepted (Phase 2)
- Deciders: VoxelPulse maintainers
- Date: 2026-09

## Context

Phase 1 hard-wired import logic into the app shell: `parsePointFile(name, buf)`
dispatched by file extension, App.tsx owned parsing/bounds/layer creation, and
the renderer consumed a live-frame buffer that made no distinction between
telemetry and imported static data. Every future format (LAZ, COPC, GeoTIFF,
ROS bags) and every future delivery path (HTTP ranges, native/Tauri, backend)
would have multiplied that entanglement.

Phase 2's mandate is architecture, not visible features: separate the concepts
so future formats become *new adapters*, sources become *new providers*, and
nothing else changes (§1, §122 of the phase directive).

## Decision

Five explicit concepts, never collapsed into one object:

```
Source        where bytes come from        (LocalFileSource, UrlSource, MemorySource)
   ↓
FormatAdapter how bytes are interpreted    (las, ply, pcd, xyz — one module each)
   ↓
Dataset       what logically exists        (DatasetDescriptor — serializable)
   ↓
Resources     which chunks are loaded      (ResourceManager — runtime only)
   ↓
Layer         how it appears in a project  (projectStore — datasetId reference)
   ↓
Renderer      what is drawn                (reused-GPU-buffer path, §ADR-0001)
```

Key commitments:

1. **Sources expose capabilities, not types** (`randomAccess`, `streaming`,
   `knownSize`, `persistentReference`). COPC/COG feasibility later is a
   capability check, not an instanceof (§3).
2. **Byte ranges are first-class.** Adapters inspect via partial reads where
   the format allows (LAS 375 B header, PLY/PCD header windows); whole-file
   decode remains documented debt for all four current formats (§66).
3. **Descriptor ≠ runtime.** `DatasetDescriptor` (plain JSON) is the only
   thing projects serialize; `OpenedDataset` and decoded chunks live in
   `DatasetManager`/`ResourceManager`, outside React state (§18, §34).
4. **Chunks exist now, LOD does not.** Every current file is chunk 0 of 1;
   the request/evict contract prepares the massive-data phase without
   pretending Phase 2 streams anything (§40–42).
5. **One import pipeline.** Add Data, multi-file selection and drag-drop all
   route through `importService.importSource`; the app contributes exactly
   three hooks (createLayer, frameBounds, notifyError) (§50, §92).
6. **Format knowledge lives in adapters only.** No format switches in
   components/stores; detection is content-first via the registry with
   explicit ambiguity errors (§10–12).
7. **Static vs temporal split is documented, not forced.** Live VPF1
   telemetry remains a temporal frame provider feeding the same GPU buffer;
   imported files arrive as decoded chunks through `chunkToFrame`. Both share
   the point shader, colormaps and layer styles (§84–87).
8. **Honest persistence.** Local files cannot be silently reopened after
   reload; `.vxp` v2 stores source descriptors and the UI treats missing
   local data as a fact, not an error to hide (§46, §78).
9. **Module boundary**: `frontend/src/core/data/` (source/, formats/,
   workers/, resources/, jobs/) — no monorepo split yet; the directory is a
   package seam if extraction is ever justified (§72).

## Consequences

- Adding LAZ/COPC/GeoTIFF/ROS later means: new parser (+adapter), register it,
  extend the capability table, add fixtures/tests. No app-layer changes.
- Inspector/status bar read dataset-owned metadata — one factual source, no
  duplicate state (§53, §79).
- Whole-file decode caps practical dataset size (~400k points, 800 MB guard);
  this is explicit and surfaced in UX, not latent (§113, §116).
- Parser input is hostile: counts/offsets/strides validated, structured errors
  only (§32, §112–114).

## References

- ADR-0001 renderer abstraction, ADR-0002 layer/dataset model, ADR-0004 .vxp
- docs/development/format-adapters.md — how to add a format
