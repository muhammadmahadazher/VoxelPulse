# GIS rasters & terrain — user guide

Phase 5 adds GeoTIFF/COG rasters, a 2D Map workspace, real DEM terrain,
scientific hillshade, orthophoto draping and LiDAR fusion to VoxelPulse.
All geospatial display goes through the Phase 3 CRS pipeline (project CRS,
render origin, honest UNKNOWN handling).

## Open a GeoTIFF

**Add Data** (or drag-and-drop) accepts `.tif/.tiff` alongside the point
cloud formats. VoxelPulse detects the format by content (TIFF magic — the
extension is only a hint), reads metadata through geotiff.js over VoxelPulse's
own byte-range source, and attaches a streaming raster runtime:

- the **Map workspace** focuses automatically on a fresh import;
- the raster streams tile-by-tile through the tile scheduler (viewport
  culling, overview selection by measured texel size, bounded decode cache);
- the Inspector's **Raster** section shows dimensions, bands, sample type,
  nodata, compression, layout, overviews, CRS and the measured stretch;
- the pixel probe reports **world coordinates + raw pixel values** (click in
  the map; drag pans, wheel zooms — zoom is cursor-anchored).

Supported: classic TIFF + BigTIFF, LE/BE, LZW/Deflate/JPEG(decode)/Packbits/
Zstd (geotiff.js decoders), strip and tiled layouts, overviews measured from
the real IFDs. Whole-file decode never happens.

## Open a COG by URL

**File → Open URL…** with an `http(s)` URL to a GeoTIFF/COG. Every byte —
header, IFDs, tiles — arrives as an HTTP **Range request** through VoxelPulse's
DataSource accounting (geotiff's own HTTP client is never used). A raster is
labeled **COG (verified)** in the Inspector only when the file carries the
GDAL ghost-area signature + tiled layout + overview IFDs; tiled-but-not-COG
files honestly report "tiled TIFF".

## View a DEM as 3D terrain

Select the raster layer → Inspector → **3D terrain** toggle. The DEM streams
into the perspective scene as tiled meshes in the SAME render space as point
clouds (Z-up, shared render origin, CRS-transformed):

- vertices sit at pixel-corner positions through the full affine (rotated
  rasters stay rotated); neighboring tiles share exact corner samples (the
  runtime decodes one extra column/row), so there are no seams;
- nodata becomes a hole — triangles are skipped, never zero-filled;
- **Exaggeration** scales the mesh visually only — raw elevations are
  untouched, and the probe/terrain sampler always reads true values.

## Apply an orthophoto

With a terrain-enabled raster selected: Inspector → **Drape imagery** → pick
another raster layer. Imagery drapes per-vertex through each raster's own
affine; a different imagery CRS transforms per-vertex through the project's
proj4 pipeline. If the imagery cannot be placed honestly (UNKNOWN CRS,
outside the extent, tiles not resident yet) you get a console warning and
base shading — never guessed offsets.

## Combine terrain and LiDAR

Import a georeferenced point cloud (LAS/COPC) together with a DEM: both
co-render in the 3D scene in project coordinates. VoxelPulse proves the
alignment numerically — the Phase 5 acceptance test loads a LiDAR block that
flies 2.0 m above the DEM surface and asserts the terrain sampler reads the
DEM formula value exactly at the points' (E, N) (see
`tests/fusion.e2e.ts`).

## Styling

Inspector → **Mode**: `auto` (RGB for ≥3 bands, grayscale otherwise),
`rgb` (with band remapping), `grayscale`, `pseudocolor` (perceptual ramp),
`hillshade` (sun **azimuth**/`elevation` steppers; gradients from real
elevation data with CRS-aware metre spacing — degree CRSs are converted at
the raster's mean latitude). Display stretch uses **measured** dataset
statistics from the file's coarsest overview — the Inspector shows the real
numbers. Raw pixel values are never quantized into the analysis path; only
the display buffer is packed.

## Projects (.vxp v4)

Save/open persists raster descriptors, source references, display style
(mode, sun, band mapping), terrain role, drape reference, exaggeration, map
layout and project CRS — references only, never tiles or meshes. Local files
re-open via the relink flow; remote rasters re-open through source-backed
streaming. v1–v3 projects migrate losslessly.

## Known limitations (honest)

- Elevation units are taken as the raster's horizontal CRS units (metre
  CRSs → metre elevations); there is no vertical-datum transformation.
- Draping samples imagery at terrain-vertex resolution (mesh grid ≤ 33 per
  side) — appropriate for the current renderer, not full ortho sharpness.
- The 2D Map assumes the project space == raster CRS for aligned imports
  (Phase 3 reprojected-display covers point clouds; raster reprojection on
  import lands with future work — cross-CRS *draping* is supported).
- Hillshade edge pixels replicate-clamp neighbors (standard behavior);
  the outermost pixel ring of a tile uses clamped samples.
- geotiff.js's own HTTP client is bypassed (ADR-0009); blocked-slice
  coalescing still applies through its BlockedSource.
