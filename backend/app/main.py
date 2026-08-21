"""VoxelPulse backend — FastAPI server with binary WebSocket telemetry stream.

Protocol (single binary message per frame):
    [4B magic "VPF1"][2B header_len][header JSON utf8][payload]
    payload = positions float32 (N*3) ++ intensity float32 (N) ++ camera rgb uint8 (H*W*3)

Client -> server text commands: {"cmd": "pause" | "resume" | "set_points", ...}
"""
from __future__ import annotations

import asyncio
import json
import struct
import time

import numpy as np
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .processing import grid_clusters, range_histogram, ransac_ground
from .telemetry_generator import TelemetryGenerator

MAGIC = b"VPF1"
FPS = 30.0

app = FastAPI(title="VoxelPulse", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

state = {"n_points": 25000, "paused": False, "clients": 0}
_start = time.time()


@app.get("/api/health")
async def health():
    return {
        "status": "ok", "uptime_s": round(time.time() - _start, 1),
        "clients": state["clients"], "fps": FPS, "n_points": state["n_points"],
        "sensors": [{"id": "sim-lidar-64", "type": "lidar", "status": "online"},
                    {"id": "sim-cam-rgb", "type": "camera", "status": "online"}],
    }


def _build_frame(gen: TelemetryGenerator) -> bytes:
    frame = gen.step(1.0 / FPS)
    hdr = {
        "ts": frame.timestamp,
        "n": int(len(frame.points)),
        "objects": frame.objects,
        "objects2d": TelemetryGenerator.project_boxes(frame.objects, gen.cam_w, gen.cam_h),
        "cam_w": gen.cam_w, "cam_h": gen.cam_h,
    }
    header = json.dumps(hdr, separators=(",", ":")).encode()
    payload = (
        frame.points.astype("<f4").tobytes()
        + frame.intensity.astype("<f4").tobytes()
        + frame.camera.astype(np.uint8).tobytes()
    )
    return MAGIC + struct.pack("<H", len(header)) + header + payload


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    state["clients"] += 1
    gen = TelemetryGenerator(n_points=state["n_points"])
    try:
        recv_task = asyncio.create_task(_reader(ws, gen))
        async def send_loop():
            period = 1.0 / FPS
            next_t = time.perf_counter()
            while True:
                t0 = time.perf_counter()
                msg = await asyncio.to_thread(_build_frame, gen)
                await ws.send_bytes(msg)
                dt = time.perf_counter() - t0
                next_t += period
                await asyncio.sleep(max(0.0, next_t - time.perf_counter()))
        try:
            await send_loop()
        finally:
            recv_task.cancel()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        state["clients"] -= 1


async def _reader(ws: WebSocket, gen: TelemetryGenerator):
    while True:
        try:
            raw = await ws.receive_text()
            cmd = json.loads(raw)
        except Exception:
            return
        c = cmd.get("cmd")
        if c == "set_points":
            n = int(max(2000, min(60000, cmd.get("n", 25000))))
            gen.n_points = n
        elif c == "regen":
            gen.agents = gen._spawn_scene()


# ---------------------------------------------------------------- file upload
@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    """Mode B: parse uploaded .ply / .pcd / .las (xyz [+ intensity]) clouds."""
    data = await file.read()
    name = (file.filename or "").lower()
    try:
        pts = _parse_cloud(data, name)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if pts is None or len(pts) == 0:
        return JSONResponse({"error": "no points parsed"}, status_code=400)
    return _analyze_static(pts)


def _parse_cloud(data: bytes, name: str):
    if name.endswith(".ply"):
        return _parse_ply(data)
    if name.endswith(".pcd"):
        return _parse_pcd(data)
    if name.endswith(".las"):
        return _parse_las(data)
    return None


def _parse_ply(data: bytes):
    header_end = data.find(b"end_header")
    if header_end == -1:
        raise ValueError("bad PLY header")
    header = data[:header_end].decode(errors="ignore")
    n = int(next(l.split()[-1] for l in header.splitlines() if l.startswith("element vertex")))
    body = data[header_end + len(b"end_header\n"):]
    return np.frombuffer(body[: n * 3 * 4], "<f4").reshape(n, 3).astype(np.float64)


def _parse_pcd(data: bytes):
    header = data[: data.find(b"DATA")].decode(errors="ignore")
    n = int(next(l.split()[-1] for l in header.splitlines() if l.startswith("POINTS")))
    off = data.find(b"\n", data.find(b"DATA")) + 1
    return np.frombuffer(data[off: off + n * 3 * 4], "<f4").reshape(n, 3).astype(np.float64)


def _parse_las(data: bytes):
    n = struct.unpack_from("<I", data, 107)[0]
    off = struct.unpack_from("<H", data, 96)[0]
    pts = np.frombuffer(data, dtype=np.uint8, count=n * 20, offset=off).reshape(n, 20)
    xyz = pts[:, 0:12].copy().view("<i4").reshape(n, 3).astype(np.float64) * 0.001
    return xyz - xyz.mean(0)


def _analyze_static(pts: np.ndarray):
    mask = ~ransac_ground(pts)
    clusters = grid_clusters(pts[mask])
    return {
        "n": int(len(pts)),
        "ground_points": int(mask.sum()),
        "range_hist": range_histogram(pts).tolist(),
        "clusters": clusters.tolist(),
        "bounds": pts.min(0).tolist() + pts.max(0).tolist(),
    }
