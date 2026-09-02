# ADR-0007: Spatial Reference & Transformations

- Status: accepted (Phase 3)
- Date: 2026-09

## Context

Phase 2 gave every dataset bounds in an implicit local XYZ space. A
professional spatial tool must distinguish *where a number came from*
(dataset CRS), *where it exists in the project* (project CRS), and *where the
GPU draws it* (render-local, origin-subtracted) — and must never mix them
silently. This ADR fixes the representation, the transformation engine, and
the precision strategy (§2, §5–7, §35–37 of the Phase 3 directive).

## Decision

### 1. SpatialReference representation

A normalized, resolved description — not a raw string:

```ts
interface SpatialReference {
  id: string;                    // canonical, e.g. "EPSG:32643" | "VP:LOCAL" | "VP:UNKNOWN"
  kind: "local" | "unknown" | "projected" | "geographic" | "geocentric";
  authority?: string; code?: string;
  name?: string;
  projString?: string;           // proj4 definition for transformable CRS
  horizontalUnit: UnitInfo;      // metre, degree, …
  verticalUnit?: UnitInfo;
}
```

- **LOCAL** (`VP:LOCAL`) and **UNKNOWN** (`VP:UNKNOWN`) are explicit values —
  absence of CRS is not LOCAL (§3, §11). Demo/sensor data is LOCAL by intent;
  text imports without CRS metadata are UNKNOWN.
- **Axis order (§55, §56):** VoxelPulse's internal tuple convention is
  `x = easting | longitude, y = northing | latitude, z = up`, always. CRS
  metadata may formally declare lat-first axes; normalization happens once at
  the registry/transform boundary, never in components. EPSG:4326 tuples in
  VoxelPulse are lon, lat — documented and tested.

### 2. EPSG strategy & registry (§4, §7–8, §107–108)

`spatialReferenceRegistry.resolve(id)` accepts `"EPSG:32643"`, `"epsg:4326"`,
`"4326"` (EPSG implied when unambiguous) and returns a cached normalized
`SpatialReference`. No shipping of the full EPSG database: the registry
bundles WGS 84 geographic, Web Mercator, and **generates all 120 UTM zones
programmatically** (survey/LiDAR bread-and-butter, zero database cost,
fully offline). Other codes are rejected with a structured error and a
"proj4 definition / WKT assign" escape hatch. This keeps the bundle small and
offline-capable; a lazy remote EPSG lookup can slot behind the same interface
later.

### 3. Transformation engine (§5 evaluation)

Evaluated: **proj4js**, WASM PROJ ports (proj-wasm class), and hand-rolled
formulas.

| Criterion | proj4js (chosen) | WASM PROJ |
|---|---|---|
| Accuracy | standard (sub-metre class for common CRS; see limits) | survey-grade with grids |
| CRS coverage | proj strings + WKT1 parsing + bundled defs | full EPSG DB + grids |
| Size | ~70 KB min / ~20 KB gzip + types | multi-MB .wasm |
| Datum grids | ✗ none | optional (huge downloads) |
| License / maintenance | MIT / maintained (proj4js) | MIT / younger ports |
| Browser fit | native JS, worker-safe | loader + wasm heap management |

**Chosen: proj4js.** It covers Phase 3's scope (geographic ↔ projected ↔
Web Mercator ↔ UTM) with a small, offline, worker-safe dependency. **Known,
prominent limitation (§33): no datum grid-shift files — datum transformations
beyond 7-parameter Helmert (e.g. NAD27→WGS84 via grids, ETRS89 realizations)
are NOT survey-grade.** This is documented in user docs; the `TransformService`
interface is engine-agnostic so a WASM PROJ can replace it later without
architectural change (§94: WASM evaluated, not adopted — no benchmark
justification at current dataset sizes).

### 4. Project CRS & transformation flow (§9, §16, §41–42)

Every project has an explicit spatial reference, defaulting to LOCAL. Datasets
carry `spatialReference` + provenance (`embedded`/`user`/`inferred`/`generated`
— never fake confidence). Assignment (interpret existing numbers under a CRS)
is distinct from reprojection (compute new coordinates) in both architecture
and UX. Transformation happens **at chunk preparation**, per chunk — never as
a whole-dataset requirement:

```
DecodedChunk (source coords; Float64 where precision demands, §87–91)
   → CRS transform (source → project/world; identity for LOCAL/aligned)
   → subtract render origin (stable per project, §37; rebasing supported, §38)
   → Float32 render coords → GPU
```

Source coordinates and factual metadata are never mutated (§43–44); the
descriptor keeps the original CRS. Z passes through horizontal transforms
untouched and is documented as such — no pretend vertical datum work (§34, §60).

### 5. Precision strategy (§35, §82, §97–98)

Rendered coordinates are **always origin-relative Float32**. A stable render
origin (default: center of the first aligned dataset's projected bounds) keeps
GPU values small; the inspector/status convert render → world → display using
Float64. A mandatory regression test proves centimetre separation survives at
~600k/3.5M-metre world coordinates, and a companion test demonstrates raw
Float32 world coordinates lose it. Camera near/far remain render-local, so
clipping stays sane across scan/city/Earth scales.

## Consequences

- LAS WKT VLRs (LASF_Projection, record 2112) are read for EPSG identification;
  GeoTIFF-key VLRs (2111/2113/2114) are **not** parsed in Phase 3 — documented
  partial support (§13–14).
- CRS/WKT strings are untrusted: bounded lengths, never injected into HTML (§109).
- Future globe/Earth-scale work needs dynamic origin rebasing — the origin is
  an explicit `RenderOrigin` object behind a conversion boundary, not a
  scattered offset (§38, §83).

## References

- proj4js — https://github.com/proj4js/proj4js (MIT)
- OGC WKT2 / EPSG Geodetic Parameter Dataset — authority for identifiers
- LAS 1.4 R13/R14 — LASF_Projection VLR records 2111–2114
