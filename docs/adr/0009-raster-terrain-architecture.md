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

## References

- OGC COG spec — docs.ogc.org/is/21-026/21-026.html
- geotiff.js — github.com/geotiffjs/geotiff.js (MIT)
- ADR-0005 (data engine), ADR-0007 (CRS), ADR-0008 (streaming)
