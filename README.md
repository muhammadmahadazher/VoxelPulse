<div align="center">

<img src="docs/banner.svg" alt="VoxelPulse banner" width="100%"/>

# VoxelPulse

**Industrial-Grade 3D LiDAR & Vision Sensor Fusion Studio — v3.0**

A perception engineering workbench in the spirit of Foxglove Studio and Rerun.io:
Eye-Dome-Lit point clouds, multi-viewport fusion, a dockable blueprint/inspector
workspace, synchronized timeline replay, and spatial power tools — streaming at
30 FPS from the FastAPI backend or its built-in browser simulation engine.

[![CI](https://github.com/muhammadmahadazher/VoxelPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadmahadazher/VoxelPulse/actions)
[![Deploy](https://github.com/muhammadmahadazher/VoxelPulse/actions/workflows/deploy.yml/badge.svg)](https://github.com/muhammadmahadazher/VoxelPulse/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-38BDF8.svg)](LICENSE)
[![Live Studio](https://img.shields.io/badge/live-GitHub%20Pages-F59E0B.svg)](https://muhammadmahadazher.github.io/VoxelPulse/)
[![React 18](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)](frontend/package.json)
[![Three.js](https://img.shields.io/badge/three.js-r169-000?logo=three.js)](frontend/package.json)

</div>

---

## 🌐 Live Studio

**https://muhammadmahadazher.github.io/VoxelPulse/** — auto-deployed on every
push. Deep-link layouts with query params: `?layout=split` (3D + BEV) or
`?layout=fusion` (camera fusion); `?mode=sim` forces the offline engine.

## ✨ What's Inside

### Rendering Engine
- **Eye-Dome Lighting (EDL)** — screen-space, depth-aware post pass (Bauszat et
  al. technique, as used by Potree/ParaView): 4-neighbour log-depth comparison
  darkens discontinuities, giving dense clouds tactile relief and readable
  silhouettes. Togglable, runs with Bloom + Vignette + Chromatic Aberration.
- **Gaussian splat points** — anti-aliased soft discs with 1/d perspective
  attenuation; intensity gate + ROI rejection computed in-shader.
- **8 colormaps** — Cyber-Neon, Turbo, Viridis, Magma (reflectivity),
  Infrared (ToF echo), Height/Z, Semantic classification (ground/objects/
  structures), and Radial proximity zones (0–10 / 10–30 / 30–80 m).
- **Aerospace ego frame** — labeled XYZ triad (X red / Y green / Z blue with
  arrowheads), range rings (10/25/50/100 m), spinning 360° sweep, ego sensor mesh.
- **Perception meshes** — oriented boxes with corner brackets, tinted
  translucent faces, pulsing reticles, 3D velocity arrows, and ground-footprint
  shadows.

### Studio Workspace (Foxglove-style)
- **Left dock — Blueprint tree**: hierarchical scene entities (Ego Sensor,
  Ground, Range Rings, Point Stream, Detected Objects, Camera 01, Calibration
  axes), shading toggles (EDL, FX, ruler, inspector, crop gizmo, density map),
  colormaps and scenario engine — all in collapsible sections.
- **Right dock — Inspector**: click any track for UUID, class probability,
  L×W×H, position, distance, yaw, velocity vector and speed; live point probe
  (XYZ / range / intensity 0–255); docked Camera 01 feed (Front/Rear/BEV).
- **Bottom — Telemetry & playback studio**: synchronized timeline scrubber over
  a 150-frame telemetry buffer with step, loop, 0.25×–4× speed replay, and
  LIVE/REPLAY modes; time-series sparklines (FPS, latency, points, tracks);
  toggleable BEV density heatmap.
- **Multi-viewport layouts** (`V`): 3D orbit · Split 3D + orthographic BEV ·
  2D/3D Camera Fusion view (RGB feed with live projected point overlay).

### Power Tools & Data Hub
- 📏 Dual-point laser measure — distance, ΔX/ΔY/ΔZ, slope angle (`M`)
- ✂️ Interactive 6-handle 3D ROI crop gizmo (`X`) — GPU-side filtering
- 📂 Drag & drop import — `.las` (binary), `.ply`, `.pcd`, `.xyz`
- 💾 ROI-filtered export to `.PLY` / `.PCD`; 4K clean canvas snapshots (`S`, `E`)
- ⌘ Command palette (`Ctrl+K`) — every action, one keystroke away

### Fusion Backend (optional)
FastAPI WebSocket streaming packed `VPF1` binary frames at 30 FPS, a synthetic
scene engine (urban traffic with buildings/vegetation, warehouse AGVs, drone
overflight), RANSAC ground segmentation + Euclidean clustering in NumPy, and a
standalone WebWorker sim engine that takes over automatically on static hosting.

## 🚀 Quick Start

```bash
git clone https://github.com/muhammadmahadazher/VoxelPulse.git
cd VoxelPulse
./start.sh        # macOS / Linux   (Windows: start.bat)
```

Open **http://localhost:5173**. No backend needed — the studio boots into SIM
ENGINE mode automatically and upgrades to LIVE SENSOR when the backend answers.

<details>
<summary><b>Manual setup</b></summary>

```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev
```
</details>

## ⌨️ Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `Ctrl/⌘ K` | Command palette | `Space` | Play / pause |
| `V` | Cycle viewport layout | `X` | ROI crop gizmo |
| `M` | Laser ruler | `C` | Cycle colormap |
| `R` / `T` / `F` | Orbit / top-down / chase | `S` / `E` | 4K PNG / PLY export |
| `Esc` | Clear selection + ruler | | |

## 🏗 Architecture

```
Backend (FastAPI, optional)          Studio Frontend (React + Three.js)
┌──────────────────────────┐         ┌─────────────────────────────────────┐
│ sim scenes + VPF1 frames │ ── ws ──▶ ws.ts ─ ring buffer ─▶ timeline     │
│ RANSAC / clustering      │   30fps │  └ failover < 3s ▶ simWorker (WW)   │
└──────────────────────────┘         │ store ─▶ GLSL points + EDL + FX     │
                                     │  ├─ blueprint dock / inspector dock │
                                     │  ├─ 3D · BEV ortho · fusion canvas  │
                                     │  └─ crop gizmo · ruler · exporters  │
                                     └─────────────────────────────────────┘
```

## 📁 Layout

```
backend/                      # FastAPI telemetry server + processing pipeline
frontend/src/scene/           # Viewport, EDL effect, shaders, boxes, ego frame, gizmo
frontend/src/ui/              # HudBar, StudioLeft/Right/Bottom, palette, inspector
frontend/src/sim/simWorker.ts # standalone WebWorker simulation engine
frontend/src/utils/           # .las/.ply/.pcd/.xyz parsers · PLY/PCD/4K exporters
.github/workflows/            # ci.yml (test+build) · deploy.yml (GitHub Pages)
```

## 🛠 Stack

React 18 · TypeScript (strict) · Vite · Three.js · @react-three/fiber & drei ·
postprocessing (custom EDL Effect) · Zustand · Framer Motion · Tailwind ·
Lucide — Python 3.12 · FastAPI · NumPy on the backend.

## 🔁 CI/CD

Backend smoke tests + strict frontend build on every PR (`ci.yml`); production
build with Pages base path and official artifact deploy on main (`deploy.yml`).

## 🤝 Contributing

PRs welcome — CI gates on a strict TypeScript build and backend smoke tests.

## 📄 License

MIT © [Muhammad Mahad Azher](https://github.com/muhammadmahadazher)
