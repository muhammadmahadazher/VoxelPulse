# ADR-0009: Raster & Terrain Architecture

- Status: accepted (Phase 5)
- Date: 2026-10

## Context

Phase 5 adds the first genuine GIS capabilities: GeoTIFF/COG imagery, the 2D
Map workspace, elevation terrain, hillshade, and imagery draping. The
out-of-core COPC engine, CRS system, DataSource abstraction, WorkerPool and
ResourceManager are accepted infrastructure and must be extended, not
replaced (§2, §6).

## Ecosystem evaluation (§4, §14)

| Candidate | Purpose | License | Size | Verdict |
|---|---|---|---|---|
| **geotiff.js 3.x** | TIFF/GeoTIFF/COG decode: windowed reads, overviews, BigTIFF, LZW/Deflate/JPEG(decode) | MIT | ~250 KB gzip | **ADOPT** — the proven browser raster decoder; windowed reads + overview selection match the tile-scheduler model exactly |
| @cogeotiff/core | Newer TS COG reader | MIT | small | Decline — younger API, smaller feature surface for non-COG TIFFs |
| GDAL/WASM | Full GDAL | MIT/Apache | multi-MB | Decline — massive overkill for decode-only |
| hand-rolled TIFF parser | — | — | — | Decline — §14 explicitly prefers a proven decoder |

**Key integration decision:** geotiff.js accepts a custom `BaseSource`
(`fetch(slices, signal) → ArrayBuffer[]`). VoxelPulse implements
`VpGeoTIFFSource` wrapping our `DataSource` — every TIFF byte range flows
through the Phase 2 accounting, range cache and budgets. geotiff.js's own
HTTP client is never used, so there is no parallel unbounded fetch cache
(§14). Its internal decode `Pool` is bounded/disabled in favor of our
WorkerPool for heavy paths.

## Decision

1. **Raster data model (§7–9):** `DatasetKind` gains `"raster"` and
   `"terrain"`. A `RasterDescriptor` carries width/height/bands/sampleType/
   nodata/tileSize/overviews/compression + an **affine GeoTransform**
   (`X = A·col + B·row + C; Y = D·col + E·row + F`) with full rotation/skew
   support and pixel-center convention handled explicitly. Descriptors are
   serializable; pixels never are.
2. **GeoTIFF adapter (§12):** content-first detection (TIFF magic + GeoTIFF
   directory keys), registered in the existing format registry.
3. **COG streaming (§13, §16–18):** a **raster-specific tile scheduler** —
   separate from the COPC octree scheduler per §6, sharing only the generic
   infrastructure (DataSource ranges, WorkerPool, ResourceManager budgets,
   AbortSignal cancellation, priority lanes). Overview selection from
   screen resolution; coarse tiles remain visible until fine tiles arrive.
4. **2D Map workspace (§23):** an orthographic north-up camera inside the
   existing Canvas — raster tiles rendered as textured meshes; pan/zoom/
   frame/probe; no map library (§24), no basemaps (§24).
5. **Terrain (§30–37):** elevation rasters are semantic terrain sources;
   per-tile meshes with skirts for seams, normals from elevation gradients,
   hillshade from proper sun-vector × surface-normal math, vertical
   exaggeration as a display-only control.
6. **Draping (§38–40):** imagery textures sampled onto terrain meshes
   through their actual geotransforms + CRS transform — no hand-tuned
   offsets.
7. **Persistence (§50):** `.vxp` formatVersion 4 with raster descriptors,
   style, band mapping, exaggeration; versions 1–3 migrate losslessly.

## Consequences

- geotiff.js is the single decoder dependency; unsupported codecs surface
  as structured errors listing the actual limitation (§12).
- Reprojection policy (§11): rasters whose CRS differs from the project CRS
  render through a projected mesh with adaptive grid density when the
  transform is resolvable by proj4; otherwise an actionable warning shows
  rather than an inaccurate layer. No survey-grade claims.
- Raster files are untrusted: width/height/band/offset validation with
  structured errors (§56); decompression bombs bounded by pixel-count caps.
- WebGL2 + iGPU target unchanged; no Cesium, no WebGPU, no basemap
  dependencies (§58–60, §24).

## Implementation addendum (Phase 5 delivery)

Decisions that crystallized while building it (CP4–CP10):

- **One source-backed handle everywhere.** Both metadata inspection and the
  streaming runtime construct `GeoTIFF.fromSource(new VpGeoTIFFSource(...))`
  over the VoxelPulse DataSource — no `fromArrayBuffer` header windows, no
  geotiff HTTP client. geotiff.js v3 defers geo tags, so georeferencing comes
  from our own raw IFD reader over a bounded header window with the deferred
  fileDirectory arrays as fallback; rotation survives (v3 would flatten
  ModelTransformation).
- **COG labeling is verified, not assumed.** `cloudOptimized` requires the
  GDAL ghost-area signature (`GDAL_STRUCTURAL_METADATA`) + tiled layout +
  overview IFDs; tiled-but-unverified files report "tiled TIFF".
- **Overview truth comes from the IFDs.** Factors are measured
  (`full.width / ov.width`) and the runtime maps factor → image index by
  dimension match — never `log2`, and the factor is never applied twice.
- **Scheduling is pixel-space through the affine.** Tiles carry world quads
  (pixel-corner → affine), so rotated rasters render rotated; AABBs are
  conservative culling bounds.
- **Terrain seams are eliminated structurally.** The runtime decodes one
  extra right/bottom column/row per tile so neighboring tiles sample the
  SAME source pixel at shared corners; the 2D display crops the texture to
  the exact tile size via a stride-aware packing.
- **Draping is per-vertex through each raster's own affine** (cross-CRS via
  the cached proj4 pipeline); unplaceable imagery keeps base shading with a
  console warning rather than guessed offsets. Sampling happens at
  terrain-vertex resolution — a documented renderer limitation.
- **Hillshade uses Horn gradients with metre spacing**: degree CRSs convert
  at the raster's mean latitude (never "degrees are metres"); the aspect
  convention flips the south-running raster row axis to compass north-up.
- **The raster runtime owns one LRU per dataset shared by the 2D map and
  the 3D terrain** (same tile cache, same budget, both renderers drive the
  same scheduler from their own viewports).

## References

- OGC COG spec — docs.ogc.org/is/21-026/21-026.html
- geotiff.js — github.com/geotiffjs/geotiff.js (MIT)
- ADR-0005 (data engine), ADR-0007 (CRS), ADR-0008 (streaming)
