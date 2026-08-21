# ADR 0002 — Dataset / FormatAdapter / Layer model

Status: Accepted (2026-08-22) · Phase 1 (Layer), Phase 2 (Dataset/Adapter)

## Context
The current app treats visibility as scattered booleans and parses files
straight into render buffers. To support GIS, large files and plugins, data
must flow through a consistent model decoupled from origin (drag-drop, URL,
WebSocket, backend) and format.

## Decision
Three types form the data spine:

```ts
interface DataSource { kind: "file" | "url" | "stream" | "demo"; name: string; /* handle/ref */ }
interface Dataset { id; source; format; metadata: { pointCount; bounds; crs? }; }
interface Layer { id; name; type: LayerType; visible; opacity; locked;
                  datasetId?; renderStyle; metadata; }
```

`FormatAdapter` (per format): `canOpen() → inspect() → open()` returning a
`Dataset`. Existing LAS/PLY/PCD/XYZ parsing migrates into adapters (Phase 2);
the Layer registry lands in Phase 1 backed by the existing stream + demo +
file loaders. Physical monorepo packages are deferred until a second build
target exists — folder-level boundaries with import direction rules suffice
now (recorded in architecture-v4.md).

## Consequences
+ New formats/origins are additive; the renderer never cares where data came
  from; layer tree, inspector and project serialization get one uniform model.
− One-time migration effort; discipline needed so shortcuts don't bypass the
  spine.

## Alternatives rejected
Per-format UI wiring (status quo — does not scale); loading everything into
one mega-buffer (blocks streaming/LOD later).
