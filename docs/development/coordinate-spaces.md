# The Three Coordinate Spaces (developer guide)

Every position in VoxelPulse belongs to exactly one of three spaces. Mixing
them is the classic GIS bug class this architecture exists to prevent.

```
DecodedChunk (source coords; Float64 for LAS/XYZ — §87–89)
        ↓  CRS transform (core/spatial/transform.ts, cached per pair)
   world/project coords (Float64)
        ↓  subtract RenderOrigin (core/spatial/coordinates.ts)
   render coords (Float32) → GPU
```

| Space | Produced by | Stored where | Precision |
|---|---|---|---|
| **Source** | format parsers | `DecodedChunk.positions` (Float64 for LAS/XYZ, Float32 for declared-f32 PLY/PCD) | source precision — never quantized early |
| **World/project** | `prepareChunk` / `transformPositions` | derived; only bounds + inspector values surface | Float64 |
| **Render** | `prepareChunk` | `PreparedChunk.positions` → renderer's reused GPU buffer | Float32 |

## Rules

1. **The renderer never learns about CRS.** It consumes prepared Float32
   arrays. It must not parse files, issue HTTP, or hold geospatial magnitudes.
2. **Source data is never mutated.** Transforms allocate new arrays; the
   descriptor keeps the original CRS and factual bounds (§43–44).
3. **The render origin is an explicit `RenderOrigin` value**
   (`utils/projectSpatial.ts`), stable per project session — not a scattered
   offset. World = render + origin; conversions happen only at the
   camera/picking/inspector bridges (§65–66).
4. **Measurement runs on world coordinates** (`core/spatial/measure.ts`) —
   origin changes cannot alter distances (tested).
5. **Inspector/status report source or world coordinates** with CRS-aware
   formatting (`core/spatial/units.ts`).
6. **Branded types** (`WorldCoordinate`, `RenderCoordinate`,
   `DatasetCoordinate`) exist to stop accidental mixing — use them at
   conversion boundaries, don't sprinkle them everywhere.
7. **Transforms are cached per (from, to) pair** — never rebuild projection
   machinery per point (§31). Batch arrays, not per-point objects (§29).
8. **LOCAL/UNKNOWN never transform** — a LOCAL project displays source
   coordinates; UNKNOWN datasets under a georeferenced project are flagged
   unaligned, never silently placed (§73).

## Where things live

- `core/spatial/reference.ts` — SpatialReference model, LOCAL/UNKNOWN
- `core/spatial/registry.ts` — id normalization, bundled CRSs (WGS 84,
  Web Mercator, 120 UTM zones), proj4/WKT definition assignment
- `core/spatial/transform.ts` — cached transforms, batch API, perf marks
- `core/spatial/coordinates.ts` — RenderOrigin, `prepareChunk` (§84 pipeline)
- `core/spatial/measure.ts` — CRS-aware measurement
- `utils/projectSpatial.ts` — app bridge: session origin, display prep,
  project-CRS-change re-transform (outside React state, §34)

## Precision invariants (tested, `core/spatial/precision.test.ts`)

- Float32 spacing at Y ≈ 3.5 M is 0.25 m — a 1 cm pair collapses under direct
  Float32 world coordinates (§82, demonstrated, not assumed).
- The same pair survives origin-relative rendering with < 1 mm error (§81).
- Separation is origin-independent; picking round-trips within 1 mm.
