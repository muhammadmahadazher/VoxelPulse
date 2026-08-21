"""Synthetic LiDAR + camera telemetry generator.

Simulates a rotating 3D sensor scanning a dynamic road scene: ground plane,
static obstacles (walls/trees) and moving agents (vehicles, pedestrians),
returned per-frame as point clouds with intensity + per-object ground-truth
oriented bounding boxes (x, y, z, dx, dy, dz, yaw, label, track_id).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Tuple

import numpy as np

VEHICLE_DIMS = {"car": (4.2, 1.8, 1.5), "truck": (7.5, 2.4, 2.8), "cyclist": (1.8, 0.6, 1.7)}
PED_DIMS = (0.6, 0.6, 1.75)
LABELS = ["car", "truck", "pedestrian", "cyclist"]


@dataclass
class Agent:
    label: str
    pos: np.ndarray
    vel: np.ndarray
    dims: Tuple[float, float, float]
    yaw: float
    track_id: int
    phase: float = field(default_factory=lambda: float(np.random.rand() * 2 * np.pi))


@dataclass
class Frame:
    points: np.ndarray      # (N, 3) float32
    intensity: np.ndarray   # (N,) float32
    objects: List[dict]
    camera: np.ndarray      # (H, W, 3) uint8 synthetic RGB
    timestamp: float


class TelemetryGenerator:
    """Dynamic road-scene generator with moving agents and sensor noise."""

    def __init__(self, n_points: int = 25000, seed: int = 7):
        self.rng = np.random.default_rng(seed)
        self.n_points = n_points
        self.t = 0.0
        self.frame_idx = 0
        self.agents = self._spawn_scene()
        # Synthetic camera intrinsics (focal, center) for 2D projection
        self.cam_w, self.cam_h = 192, 144

    # ------------------------------------------------------------------ scene
    def _spawn_scene(self) -> List[Agent]:
        agents: List[Agent] = []
        tid = 0
        lanes = [-7.0, -3.5, 0.0, 3.5, 7.0]
        for lane in lanes:
            for _ in range(self.rng.integers(1, 3)):
                label = str(self.rng.choice(["car", "car", "truck", "cyclist"]))
                fwd = 12.0 + self.rng.random() * 45.0
                speed = self.rng.uniform(6, 16) * (1 if lane <= 0 else -1)
                agents.append(Agent(
                    label=label,
                    pos=np.array([fwd, lane, 0.0]),
                    vel=np.array([-speed, 0.0, 0.0]) if lane <= 0 else np.array([speed, 0.0, 0.0]),
                    dims=VEHICLE_DIMS[label],
                    yaw=0.0 if lane <= 0 else np.pi,
                    track_id=tid,
                ))
                tid += 1
        for _ in range(6):
            side = -1 if self.rng.random() < 0.5 else 1
            agents.append(Agent(
                label="pedestrian",
                pos=np.array([self.rng.uniform(5, 45), side * self.rng.uniform(9, 14), 0.0]),
                vel=np.array([self.rng.uniform(-1, 1), -side * self.rng.uniform(0.5, 1.4), 0.0]),
                dims=PED_DIMS,
                yaw=0.0,
                track_id=tid,
            ))
            tid += 1
        return agents

    # ------------------------------------------------------------------ frame
    def step(self, dt: float) -> Frame:
        self.t += dt
        self.frame_idx += 1
        n = self.n_points
        pts = np.empty((n, 3), np.float32)
        inten = np.empty(n, np.float32)

        # 1) Ground plane (z ~ 0) with slight curl + road markings intensity
        n_ground = int(n * 0.55)
        r = 70.0 * np.sqrt(self.rng.random(n_ground))
        a = self.rng.uniform(-np.pi / 2.2, np.pi / 2.2, n_ground)
        x, y = r * np.cos(a), r * np.sin(a)
        z = 0.02 * np.sin(0.15 * x) + self.rng.normal(0, 0.02, n_ground)
        on_road = np.abs(y) < 8.0
        inten_g = np.where(on_road & (np.abs((y + 4) % 4 - 2) < 0.15), 0.95, 0.35)  # lane marks
        inten_g = np.clip(inten_g + self.rng.normal(0, 0.05, n_ground), 0, 1)
        pts[:n_ground] = np.stack([x, y, z], 1)
        inten[:n_ground] = inten_g

        # 2) Agents: box-surface sampling with per-agent class intensity
        i = n_ground
        objects: List[dict] = []
        for ag in self.agents:
            ag.pos += ag.vel * dt
            if ag.label == "pedestrian":
                ag.pos += np.array([0, np.sin(self.t * 2 + ag.phase) * 0.01, 0])
            ag.yaw = np.arctan2(ag.vel[1], ag.vel[0]) if np.hypot(*ag.vel[:2]) > 0.5 else ag.yaw
            # recycle agents that leave the field of view
            if ag.pos[0] < -15 or ag.pos[0] > 80 or abs(ag.pos[1]) > 30:
                ag.pos[0] = 70.0 if ag.vel[0] < 0 else 5.0
            objects.append({
                "id": ag.track_id, "label": ag.label, "conf": float(0.82 + 0.15 * self.rng.random()),
                "box": [float(ag.pos[0]), float(ag.pos[1]), float(ag.pos[2] + ag.dims[2] / 2),
                        ag.dims[0], ag.dims[1], ag.dims[2], float(ag.yaw)],
            })
            need = int(n * 0.45 / len(self.agents))
            sp = self._box_surface(ag, need)
            pts[i:i + len(sp)] = sp
            inten[i:i + len(sp)] = np.clip(
                0.55 + 0.3 * self.rng.random(len(sp)) + (sp[:, 2] / 3.0) * 0.15, 0, 1)
            i += len(sp)

        # 3) Static roadside clutter (poles/trees/walls) + free space fill
        remaining = n - i
        rx = self.rng.uniform(2, 70, remaining)
        ry = self.rng.choice([-1, 1], remaining) * self.rng.uniform(9, 30, remaining)
        rz = np.abs(self.rng.normal(0, 2.2, remaining))
        pts[i:] = np.stack([rx, ry, rz], 1).astype(np.float32)
        inten[i:] = np.clip(self.rng.normal(0.45, 0.15, remaining), 0, 1)

        # Sensor noise: angular jitter grows with range (realistic dropout/ghosting)
        range_ = np.hypot(pts[:, 0], pts[:, 1])
        pts += self.rng.normal(0, 0.004 + 0.002 * range_[:, None] / 10.0).astype(np.float32)

        cam = self._render_camera(pts, inten, objects)
        return Frame(pts, inten.astype(np.float32), objects, cam, time.time())

    def _box_surface(self, ag: Agent, count: int) -> np.ndarray:
        dx, dy, dz = ag.dims
        c = np.cos(ag.yaw); s = np.sin(ag.yaw)
        u = self.rng.uniform(-0.5, 0.5, (count, 3))
        face = self.rng.integers(0, 6, count)
        for ax in range(3):
            m_lo, m_hi = face == 2 * ax, face == 2 * ax + 1
            u[m_lo, ax] = -0.5; u[m_hi, ax] = 0.5
        local = u * np.array([dx, dy, dz])
        wx = ag.pos[0] + local[:, 0] * c - local[:, 1] * s
        wy = ag.pos[1] + local[:, 0] * s + local[:, 1] * c
        wz = ag.pos[2] + local[:, 2]
        return np.stack([wx, wy, wz], 1).astype(np.float32)

    def _render_camera(self, pts: np.ndarray, inten: np.ndarray, objects: List[dict]) -> np.ndarray:
        """Cheap pinhole projection of the point cloud into a synthetic RGB frame."""
        w, h = self.cam_w, self.cam_h
        img = np.zeros((h, w, 3), np.uint8)
        img[:] = (12, 14, 22)
        fx = fy = w * 1.1
        cx, cy = w / 2, h / 2
        m = (pts[:, 0] > 1.0) & (np.abs(pts[:, 1]) < 35) & (pts[:, 2] > -1)
        p = pts[m][: w * h // 4]
        it = inten[m][: len(p)]
        if len(p):
            u = (fx * (-p[:, 1] / p[:, 0]) + cx).astype(int)
            v = (fy * ((1.6 - p[:, 2]) / p[:, 0]) + cy).astype(int)
            ok = (u >= 0) & (u < w) & (v >= 0) & (v < h)
            u, v, it = u[ok], v[ok], it[ok]
            img[v, u, 1] = np.maximum(img[v, u, 1], (90 + 140 * it).astype(np.uint8))
            img[v, u, 2] = np.maximum(img[v, u, 2], (60 + 120 * it).astype(np.uint8))
        return img

    # ------------------------------------------------------------------ boxes2d
    @staticmethod
    def project_boxes(objects: List[dict], w: int = 192, h: int = 144) -> List[dict]:
        """Project 3D OBBoxes into camera-space 2D boxes for the PiP overlay."""
        out = []
        fx = fy = w * 1.1
        cx, cy = w / 2, h / 2
        for o in objects:
            x, y, z, dx, dy, dz, yaw = o["box"]
            if x <= 1.5:
                continue
            corners = np.array([[dx / 2, dy / 2], [dx / 2, -dy / 2], [-dx / 2, -dy / 2], [-dx / 2, dy / 2]])
            c, s = np.cos(yaw), np.sin(yaw)
            wc = np.stack([corners[:, 0] * c - corners[:, 1] * s + x, corners[:, 0] * s + corners[:, 1] * c + y], 1)
            u = (fx * (-wc[:, 1] / wc[:, 0]) + cx) / w
            v0 = (fy * ((1.6 - z - dz / 2) / x) + cy) / h
            v1 = (fy * ((1.6 - z + dz / 2) / x) + cy) / h
            x0, x1 = np.clip(wc[:, 0], None, None), None
            u0, u1 = float(np.min(u)), float(np.max(u))
            out.append({"id": o["id"], "label": o["label"], "conf": o["conf"],
                        "u": u0, "v": float(min(v0, v1)), "w": max(u1 - u0, 0.02),
                        "h": float(abs(v1 - v0) + 0.01)})
        return out
