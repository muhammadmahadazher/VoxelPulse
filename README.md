<div align="center">

<img src="docs/banner.svg" alt="VoxelPulse banner" width="100%"/>

# VoxelPulse

**Real-Time 3D LiDAR & Vision Sensor Fusion Dashboard**

Ultra-premium, cyber-HUD style dashboard for streaming, processing and visualizing
3D point clouds at 30 FPS over binary WebSockets.

[![CI](https://github.com/muhammadmahadazher/VoxelPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadmahadazher/VoxelPulse/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-00F5FF.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](backend/requirements.txt)
[![React 18](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)](frontend/package.json)
[![Three.js](https://img.shields.io/badge/three.js-r169-000?logo=three.js)](frontend/package.json)

</div>

---

## ✨ Features

- **30 FPS binary telemetry streaming** — FastAPI WebSocket pushing packed `Float32Array` frames (~240 KB/frame at 25k points) with a 10-byte binary header protocol.
- **Synthetic sensor engine** — dynamic road scene with moving cars, trucks, cyclists and pedestrians, per-point intensity, range-dependent sensor noise, lane markings, and ground-truth oriented bounding boxes `[x, y, z, dx, dy, dz, yaw]` with confidence scores.
- **Point cloud processing pipeline** — RANSAC ground-plane segmentation, voxel hashing, and grid-based Euclidean clustering with PCA yaw estimation (pure NumPy, no heavy deps).
- **Custom GPU shaders** — point clouds rendered with vertex-computed range/elevation color maps (**Turbo**, **Viridis**, **Cyber-Green**) and intensity filtering, all in a single draw call.
- **Cyber-HUD UI** — glassmorphism panels, Framer Motion transitions, live FPS/latency/point-count chips, synchronized RGB picture-in-picture with 2D boxes and alignment crosshairs, range-distribution histogram.
- **Camera modes** — orbit, top-down (`T`), first-person chase (`F`), reset (`R`).
- **File upload analysis** — `.ply` / `.pcd` / `.las` parser endpoint with automatic ground removal + clustering stats.
- **Extensible ingestion** — Mode A synthetic generator, Mode B file upload, Mode C hook ready for ROS2 / serial sensors.

## 🚀 Quick Start

```bash
git clone https://github.com/muhammadmahadazher/VoxelPulse.git
cd VoxelPulse
./start.sh        # macOS / Linux   (Windows: start.bat)
```

Then open **http://localhost:5173** — the script installs everything and boots both servers.

<details>
<summary><b>Manual setup</b></summary>

```bash
# 1. Backend (http://localhost:8000)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. Frontend (http://localhost:5173)
cd ../frontend
npm install
npm run dev
```
</details>

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Pause / resume stream |
| `R` | Reset camera to orbit view |
| `T` | Top-down orthographic view |
| `F` | First-person chase camera |
| `C` | Cycle colormap (Turbo → Viridis → Cyber) |

## 🏗 Architecture

```
┌──────────────────────────── Backend (FastAPI) ───────────────────────────┐
│  telemetry_generator.py   processing.py            main.py               │
│  ┌─────────────────────┐ ┌──────────────────┐ ┌───────────────────────┐  │
│  │ synthetic 3D scene  │→│ RANSAC ground    │→│ /ws/stream  (binary)  │  │
│  │ cars · peds · noise │ │ voxel · clusters │ │ /api/upload .ply/.pcd │  │
│  │ + pinhole RGB cam   │ │ range histograms │ │ /api/health           │  │
│  └─────────────────────┘ └──────────────────┘ └───────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────────┘
                       30 FPS · binary frames (VPF1 protocol)
┌──────────────────────────────────┴───────────────────────────────────────┐
│  Frontend (React + Three.js + Zustand)                                   │
│  ws.ts ── parseFrame ──▶ store ──▶ Points ShaderMaterial (Float32 GPU)   │
│                        ▶ BBox3D wireframes + labels · PiP RGB overlay    │
│                        ▶ HUD chips · layers panel · telemetry histogram  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 📡 Wire Protocol (`VPF1`)

```
[4B magic "VPF1"][2B header_len u16][header JSON][payload]
payload = positions f32×3N  ++  intensity f32×N  ++  camera RGB u8×(W·H·3)
```
Header carries `ts`, `n`, 3D oriented boxes with class + confidence, and
camera-space 2D boxes for the PiP overlay. Clients can send text commands:
`{"cmd":"set_points","n":50000}` and `{"cmd":"regen"}`.

## 📁 Repository Layout

```
backend/
  app/main.py               # FastAPI app, WebSocket stream, upload parser
  app/telemetry_generator.py# Synthetic LiDAR+RGB scene engine
  app/processing.py         # RANSAC / voxel / clustering / histograms
  samples/                  # Demo point clouds (.ply / .pcd)
frontend/
  src/scene/                # Viewport, shaders, 3D bbox visualizer
  src/ui/                   # HudBar, PiP, LeftPanel, TelemetryStrip
  src/store.ts              # Zustand frame state
  src/ws.ts                 # Binary WebSocket client + parser
start.sh / start.bat        # One-click launchers
.github/workflows/ci.yml    # CI: backend smoke tests + frontend build + Pages
```

## 🛠 Tech Stack

**Backend** — Python 3.12 · FastAPI · Uvicorn · NumPy
**Frontend** — React 18 · TypeScript · Vite · Three.js · @react-three/fiber & drei · Zustand · Framer Motion · Tailwind CSS · Lucide

## 🗺 Roadmap

- [ ] ROS2 rclpy bridge node (Mode C ingestion)
- [ ] Open3D + DBSCAN clustering backend option
- [ ] ICP odometry & SLAM-style trail rendering
- [ ] Multi-session recording / playback timeline
- [ ] Live sensor support (Velodyne / Ouster / Livox SDKs)

## 🤝 Contributing

PRs welcome! Fork, branch (`feat/…`), and open a pull request — CI runs backend smoke tests and the frontend type-check + build on every push.

## 📄 License

MIT © [Muhammad Mahad Azher](https://github.com/muhammadmahadazher)
