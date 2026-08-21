# VoxelPulse

Open-source spatial computing for LiDAR, GIS and perception.

Explore massive point clouds, terrain, imagery and sensor data through a
GPU-accelerated 2D/3D workstation — in the browser, with zero install.

<img src="docs/banner.svg" alt="VoxelPulse" width="100%"/>

[![CI](https://github.com/muhammadmahadazher/VoxelPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadmahadazher/VoxelPulse/actions)
[![Deploy](https://github.com/muhammadmahadazher/VoxelPulse/actions/workflows/deploy.yml/badge.svg)](https://github.com/muhammadmahadazher/VoxelPulse/actions)
[![Live Studio](https://img.shields.io/badge/live-GitHub%20Pages-4DA3FF.svg)](https://muhammadmahadazher.github.io/VoxelPulse/)
[![License: MIT](https://img.shields.io/badge/license-MIT-34D399.svg)](LICENSE)

## Why VoxelPulse exists

Professional LiDAR/GIS tooling is either decades-old desktop software,
heavy enterprise platforms, or single-purpose viewers. VoxelPulse is a
**point-cloud-first spatial workstation** with a modern, fast interface —
combining a perception studio (robotics streams, detections, tracks) with a
growing GIS toolset (layers, projects, real coordinates), and it runs anywhere
a browser does.

## The v4 workstation

**Phase 1 of the v4 architecture is live** — a professional workspace shell
designed after Apple HIG, Material 3, Foxglove and Rerun research
(see [`docs/design-research.md`](docs/design-research.md)):

- **Application shell** — conventional menu bar (File / View / Data / Help),
  resizable + collapsible docked panels (drag the dividers), quiet status bar
  (`CRS · cursor XYZ · points · FPS · mode`), keyboard-first workflow.
- **Start screen** — New / Open / Add Data first; demo scenes load explicitly,
  never masquerading as real data (labeled *DEMO SCENE*).
- **Layer tree** — real layer model (visibility, opacity, lock, rename,
  reorder, zoom-to, right-click context menu) driving the renderer.
- **Contextual inspector** — layer / detection / point probe views + Camera 01.
- **Projects (`.vxp`)** — versioned JSON projects with layers, layout and
  camera; Save / Save As / Open, recent projects, autosave.
- **Command palette** — fuzzy search across commands, layers and colormaps.
- **Renderer (preserved from v3)** — Eye-Dome Lighting, soft-disc gaussian
  splats, 8 colormaps, EDL/Bloom/Vignette/CA stack, aerospace ego frame,
  holographic detection boxes, ROI crop gizmo, laser ruler, 3 viewport
  layouts (3D / split BEV / camera fusion), timeline replay.

## Quick start (60 seconds)

```bash
git clone https://github.com/muhammadmahadazher/VoxelPulse.git
cd VoxelPulse
./start.sh          # macOS / Linux (Windows: start.bat)
```

Open **http://localhost:5173**. The studio works without the Python backend
(built-in WebWorker demo engine); start it for live sensor simulation.

<details>
<summary><b>Manual / developer setup</b></summary>

```bash
# frontend (dev, test, build)
cd frontend && npm install && npm run dev
npm test          # vitest unit suites
npm run build     # strict tsc + production build

# optional processing backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
</details>

## Supported formats (honest status)

| Capability | Browser | Local backend | Status |
|---|---|---|---|
| LAS (binary) | ✓ import | ✓ import | Stable |
| PLY (ascii/binary xyz) | ✓ | ✓ | Stable |
| PCD (ascii/binary) | ✓ | ✓ | Stable |
| XYZ / CSV points | ✓ | — | Stable |
| LAZ | — | planned | Roadmap (Phase 2 adapters) |
| COPC / 3D Tiles / GeoTIFF | — | — | Roadmap (Phases 5–6) |
| Export: PLY / PCD / 4K PNG / .vxp | ✓ | — | Stable |

## Architecture

Phase 0 audit, design research, architecture and ADRs live in
[`docs/`](docs/): [audit](docs/audit-v4.md) · [design research](docs/design-research.md) ·
[architecture](docs/architecture-v4.md) · ADRs ([renderer](docs/adr/0001-renderer-abstraction.md),
[layer model](docs/adr/0002-layer-dataset-model.md), [state](docs/adr/0003-scoped-state-stores.md),
[.vxp format](docs/adr/0004-project-format-vxp.md)).

```text
File / Stream / Demo ─▶ FormatAdapter ─▶ Layer (project store)
                                             │
        menu · palette · panels (React) ─▶ scoped stores ─▶ Render engine
                                             │                (Three.js/R3F adapter)
        telemetry store ◀─ VPF1 ws / WebWorker sim ──▶ GPU buffers (EDL, splats)
```

## Roadmap

- **v4 Spatial Workstation** — ✅ shell, layers, projects, palette · ⏳ dataset/adapter architecture, worker pool, cross-sections
- **v5 GIS Foundation** — CRS (proj), vector layers, attribute table, map workspace
- **v6 Massive Data** — chunked LOD streaming, LAZ/COPC, tens-of-millions+ points
- **v7 Analysis Platform** — ground classification, DEM, clustering, jobs backend
- **v8 Extensible Spatial OS** — plugin SDK, desktop shell (Tauri), scripting

## Contributing

PRs welcome — CI gates on unit tests, strict TypeScript and the production
build. See [`docs/audit-v4.md`](docs/audit-v4.md) for the current technical
debt register.

## License

MIT © [Muhammad Mahad Azher](https://github.com/muhammadmahadazher)
