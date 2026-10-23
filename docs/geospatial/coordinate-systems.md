# Coordinate Systems in VoxelPulse

A point in VoxelPulse exists in three places at once — and they are **not**
interchangeable:

1. **Source coordinates** — the numbers as decoded from the file, in the
   dataset's own spatial reference.
2. **Project/world coordinates** — after transformation into the *project
   spatial reference*.
3. **Render coordinates** — world coordinates minus the render origin,
   narrowed to Float32 for the GPU.

The status bar and inspector always report source or world coordinates;
the renderer only ever sees small, origin-relative Float32 values. That is
why centimetre-scale geometry stays stable even at UTM magnitudes
(E 439,000 · N 3,487,000).

## LOCAL vs UNKNOWN — different things

| | Meaning | Where it appears |
|---|---|---|
| **LOCAL** | The data intentionally uses an arbitrary local frame (robotics scans, demos, sensor frames). No geographic meaning is claimed. | Demo scenes, VPF1 streams |
| **UNKNOWN** | The data *might* be geospatial, but VoxelPulse does not know its CRS. | Text imports without metadata, LAS without CRS VLRs |

VoxelPulse never guesses "these look like lat/lon, so they must be EPSG:4326".
An UNKNOWN dataset stays honest until you tell it what it is.

## Project CRS

Every project has one spatial reference (default **LOCAL**). Datasets with a
known, transformable CRS are transformed into project space automatically —
two datasets in EPSG:32643 and EPSG:4326 describing the same place will
align when the project CRS is EPSG:32643. Change the project CRS via the
status-bar CRS item (bottom-left); compatible layers re-transform
immediately. Source files are never rewritten.

## Assign vs Reproject

These are different operations — VoxelPulse keeps them separate:

- **Assign Spatial Reference** (layer context menu → *Spatial Reference…*):
  "interpret these existing numbers under this CRS." Coordinates do **not**
  change. Use it when a file lacks CRS metadata but you know what it is.
- **Reproject** would compute *new* coordinates in another CRS. Phase 3 does
  not write reprojected copies — display-time transformation covers current
  workflows, and export-time reprojection comes with a later phase.

## Supported references

Bundled and fully offline: **WGS 84** (EPSG:4326), **Web Mercator**
(EPSG:3857), and **all 120 UTM zones** (EPSG:32601–32660 north,
32701–32760 south). Arbitrary proj4 strings and WKT1 definitions can be
assigned via the chooser's *Advanced* section. Other EPSG codes are not
bundled — no EPSG database ships with the app (bundle size, offline-first).

Axis convention inside VoxelPulse is always `x = easting | longitude`,
`y = northing | latitude`, `z = up`, regardless of a CRS's formal axis order.

## Reading CRS from files

| Format | CRS support |
|---|---|
| LAS | WKT VLR (`LASF_Projection` record 2112) read automatically; provenance shown as *embedded*. GeoTIFF-key VLRs (2111/2113/2114) are **not** parsed yet. |
| PLY / PCD / XYZ | No CRS container in the format — imported as UNKNOWN; assign via the layer menu. |

## Units and measurement

CRS native units are facts (metres for UTM, degrees for WGS 84); display
formatting follows the CRS kind — `E 439,112.03 m` for projected,
`31.520370°` for geographic. The measurement tool measures in **world
coordinates**: planar distance for local/projected CRS, geodesic distance
(haversine) for geographic CRS — never naive degree hypot.

## Limitations (honest)

- **No datum grid transformations.** proj4js covers standard transformations
  but not high-accuracy grid-shift files (e.g. NAD27→NAD83 via grids).
  Datum behaviour is 7-parameter/Helmert-class at best — not survey-grade.
- **Z is passed through untouched** by horizontal transforms. There is no
  vertical datum conversion (ellipsoidal vs orthometric heights are not
  distinguished yet — the architecture stores vertical unit metadata only).
- Geodesic distance uses a spherical WGS84 approximation (≤ ~0.3 % vs
  ellipsoidal).
- One EPSG database lookup failure is a structured error, not a fallback
  guess: use the Advanced definition assignment for unbundled codes.
- Local files cannot be silently reopened after a reload — the project
  stores descriptors, and reopening offers *Locate File…* with size/name
  verification.

## For contributors

See [docs/development/coordinate-spaces.md](../development/coordinate-spaces.md)
for the three-space model, the chunk pipeline, and where conversions are
allowed to happen.
