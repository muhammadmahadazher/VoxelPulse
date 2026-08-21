/// <reference lib="webworker" />
/**
 * VoxelPulse standalone simulation worker.
 * Generates the same telemetry format as the FastAPI backend (positions,
 * intensity, 3D/2D boxes, synthetic RGB frame) entirely in the browser so the
 * dashboard works on static hosting (GitHub Pages) with zero configuration.
 */
import type { ScenarioName, SimCommand, SimFrameMsg } from "./types";

interface Agent {
  id: number;
  label: string;
  conf: number;
  x: number; y: number; z: number;
  vx: number; vy: number;
  dx: number; dy: number; dz: number;
  yaw: number;
  phase: number;
}

const VEHICLE_DIMS: Record<string, [number, number, number]> = {
  car: [4.2, 1.8, 1.5], truck: [7.5, 2.4, 2.8], agv: [2.2, 1.4, 1.2],
  forklift: [3.0, 1.2, 2.0], cyclist: [1.8, 0.6, 1.7], drone: [1.2, 1.2, 0.5],
};
const PED_DIMS: [number, number, number] = [0.6, 0.6, 1.75];
const CAM_W = 192, CAM_H = 144, FPS = 30;

let rand = mulberry(7);
let nPoints = 25000;
let scenario: ScenarioName = "urban";
let t = 0;
let frameIdx = 0;
let paused = false;
let agents: Agent[] = [];
let buildings: { x: number; y: number; w: number; h: number }[] = [];
let trees: { x: number; y: number; r: number; h: number }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

function spawn(sc: ScenarioName): Agent[] {
  rand = mulberry(Date.now() & 0xffff);
  const out: Agent[] = [];
  let id = 0;
  buildings = [];
  trees = [];
  const add = (a: Omit<Agent, "id" | "conf" | "phase">) =>
    out.push({ ...a, id: id++, conf: rr(0.82, 0.97), phase: rr(0, Math.PI * 2) });

  if (sc === "urban") {
    // roadside building blocks (front faces sampled as static returns)
    for (let i = 0; i < 7; i++) {
      buildings.push({
        x: 8 + i * 10, y: rand() < 0.5 ? -28 : 28,
        w: rr(7, 10), h: rr(6, 16),
      });
    }
    // roadside trees between road and buildings
    for (let i = 0; i < 10; i++) {
      trees.push({ x: rr(5, 70), y: (rand() < 0.5 ? -1 : 1) * rr(10.5, 16), r: rr(1.2, 2.2), h: rr(4, 7) });
    }
    for (const lane of [-7, -3.5, 0, 3.5, 7]) {
      const count = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < count; i++) {
        const label = pick(["car", "car", "truck", "cyclist"]);
        const [dx, dy, dz] = VEHICLE_DIMS[label];
        const fwd = lane <= 0 ? 1 : -1;
        add({ label, x: rr(12, 55), y: lane, z: 0, vx: -rr(6, 16) * fwd, vy: 0,
             dx, dy, dz, yaw: fwd > 0 ? 0 : Math.PI });
      }
    }
    for (let i = 0; i < 6; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      add({ label: "pedestrian", x: rr(5, 45), y: side * rr(9, 14), z: 0,
           vx: rr(-1, 1), vy: -side * rr(0.5, 1.4),
           dx: PED_DIMS[0], dy: PED_DIMS[1], dz: PED_DIMS[2], yaw: 0 });
    }
  } else if (sc === "warehouse") {
    // AGV aisles with forklifts crossing and shelf rows as static trucks
    for (const aisle of [-6, -2, 2, 6]) {
      for (let i = 0; i < 2; i++) {
        const dir = aisle < 0 ? 1 : -1;
        const [dx, dy, dz] = VEHICLE_DIMS.agv;
        add({ label: "agv", x: rr(4, 40), y: aisle, z: 0, vx: 0, vy: rr(2, 5) * dir,
             dx, dy, dz, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
    for (let i = 0; i < 3; i++) {
      const [dx, dy, dz] = VEHICLE_DIMS.forklift;
      add({ label: "forklift", x: rr(8, 35), y: rr(-9, 9), z: 0,
           vx: rr(-3, 3), vy: rr(-1, 1), dx, dy, dz, yaw: rr(0, Math.PI * 2) });
    }
    for (let row = 0; row < 4; row++)
      for (let s = 0; s < 2; s++)
        add({ label: "truck", x: 6 + row * 10, y: s === 0 ? -10.5 : 10.5, z: 0,
             vx: 0, vy: 0, dx: 8.5, dy: 1.6, dz: 4.2, yaw: 0 });
  } else { // drone: aerial sweep over a grid road network
    for (const gx of [0, 25, 50]) {
      for (let i = 0; i < 3; i++) {
        const dir = rand() < 0.5 ? 1 : -1;
        const [dx, dy, dz] = VEHICLE_DIMS.car;
        add({ label: rand() < 0.3 ? "truck" : "car", x: gx + rr(-1, 1), y: rr(-30, 30), z: 0,
             vx: 0, vy: rr(8, 18) * dir, dx, dy, dz, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
    for (let i = 0; i < 4; i++) {
      const [dx, dy, dz] = VEHICLE_DIMS.drone;
      add({ label: "drone", x: rr(5, 55), y: rr(-25, 25), z: rr(8, 25),
           vx: rr(-6, 6), vy: rr(-6, 6), dx, dy, dz, yaw: rr(0, Math.PI * 2) });
    }
  }
  return out;
}

function step(dt: number): SimFrameMsg {
  t += dt; frameIdx++;
  const n = nPoints;
  const pts = new Float32Array(n * 3);
  const inten = new Float32Array(n);

  const nGround = Math.floor(n * (scenario === "drone" ? 0.62 : 0.55));
  for (let i = 0; i < nGround; i++) {
    const r = 70 * Math.sqrt(rand());
    const a = rr(-Math.PI / 2.2, Math.PI / 2.2);
    const x = r * Math.cos(a), y = r * Math.sin(a);
    const z = 0.02 * Math.sin(0.15 * x) + randGauss() * 0.02;
    pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
    const onRoad = Math.abs(y) < 8;
    inten[i] = clamp(
      (onRoad && Math.abs(((y + 4) % 4) - 2) < 0.15 ? 0.95 : scenario === "warehouse" ? 0.42 : 0.35) +
      randGauss() * 0.05, 0, 1);
  }

  let i = nGround;
  const share = Math.floor((n * 0.42) / Math.max(agents.length, 1));
  const objects: SimFrameMsg["objects"] = [];
  for (const ag of agents) {
    ag.x += ag.vx * dt; ag.y += ag.vy * dt;
    if (ag.label === "pedestrian") ag.y += Math.sin(t * 2 + ag.phase) * 0.01;
    const speed = Math.hypot(ag.vx, ag.vy);
    if (speed > 0.5) ag.yaw = Math.atan2(ag.vy, ag.vx);
    if (ag.x < -15 || ag.x > 80 || Math.abs(ag.y) > (scenario === "drone" ? 45 : 30)) {
      if (scenario === "warehouse") { ag.vy = -ag.vy; }
      else { ag.x = 70; ag.y = rr(-25, 25); }
    }
    objects.push({
      id: ag.id, label: ag.label, conf: ag.conf,
      box: [ag.x, ag.y, ag.z + ag.dz / 2, ag.dx, ag.dy, ag.dz, ag.yaw],
    });
    const c = Math.cos(ag.yaw), s = Math.sin(ag.yaw);
    for (let k = 0; k < share && i < n; k++, i++) {
      const u = rr(-0.5, 0.5), v = rr(-0.5, 0.5), w = rr(-0.5, 0.5);
      const face = Math.floor(rand() * 3);
      const f = [u, v, w]; f[face] = rand() < 0.5 ? -0.5 : 0.5;
      const lx = f[0] * ag.dx, ly = f[1] * ag.dy, lz = f[2] * ag.dz;
      pts[i * 3] = ag.x + lx * c - ly * s;
      pts[i * 3 + 1] = ag.y + lx * s + ly * c;
      pts[i * 3 + 2] = ag.z + lz;
      inten[i] = clamp(0.55 + 0.3 * rand() + (pts[i * 3 + 2] / 3) * 0.15, 0, 1);
    }
  }
  const nStatic = n - i;
  const nBuilding = Math.floor(nStatic * (scenario === "urban" ? 0.45 : 0.1));
  const nTree = Math.floor(nStatic * (trees.length ? 0.25 : 0));
  // building front faces (walls with sparse window-intensity modulation)
  for (let k = 0; k < nBuilding && i < n; k++, i++) {
    const b = buildings.length ? buildings[Math.floor(rand() * buildings.length)] : null;
    if (!b) { i--; continue; }
    pts[i * 3] = b.x + rr(-b.w / 2, b.w / 2);
    pts[i * 3 + 1] = b.y + (b.y < 0 ? 1 : -1) * rr(0, 0.6);
    pts[i * 3 + 2] = rr(0, b.h);
    const winRow = Math.abs((pts[i * 3 + 2] % 3.5) - 1.75) < 0.5;
    inten[i] = winRow ? 0.85 : 0.3;
  }
  // vegetation: ellipsoid canopies + trunks
  for (let k = 0; k < nTree && i < n; k++, i++) {
    const t = trees[Math.floor(rand() * trees.length)];
    if (rand() < 0.2) { // trunk
      pts[i * 3] = t.x + randGauss() * 0.1;
      pts[i * 3 + 1] = t.y + randGauss() * 0.1;
      pts[i * 3 + 2] = rr(0, t.h * 0.6);
      inten[i] = 0.25;
    } else { // canopy
      const a = rr(0, Math.PI * 2), r2 = t.r * Math.sqrt(rand());
      pts[i * 3] = t.x + Math.cos(a) * r2;
      pts[i * 3 + 1] = t.y + Math.sin(a) * r2;
      pts[i * 3 + 2] = t.h * 0.6 + rr(0, t.h * 0.4);
      inten[i] = rr(0.4, 0.7);
    }
  }
  for (; i < n; i++) {
    pts[i * 3] = rr(2, 70);
    pts[i * 3 + 1] = (rand() < 0.5 ? -1 : 1) * rr(9, 30);
    pts[i * 3 + 2] = Math.abs(randGauss() * 2.2);
    inten[i] = clamp(0.45 + randGauss() * 0.15, 0, 1);
  }
  // range-dependent sensor jitter
  for (let k = 0; k < n; k++) {
    const r = Math.hypot(pts[k * 3], pts[k * 3 + 1]);
    const j = 0.004 + 0.002 * (r / 10);
    pts[k * 3] += randGauss() * j;
    pts[k * 3 + 1] += randGauss() * j;
    pts[k * 3 + 2] += randGauss() * j;
  }

  return {
    type: "frame", n, ts: Date.now(), positions: pts, intensity: inten,
    objects, objects2d: projectBoxes(objects), camW: CAM_W, camH: CAM_H,
    camRGB: renderCam(pts, inten),
  };
}

function projectBoxes(objects: SimFrameMsg["objects"]) {
  const fx = CAM_W * 1.1, cx = CAM_W / 2, cy = CAM_H / 2;
  return objects
    .filter((o) => o.box[0] > 1.5)
    .map((o) => {
      const [x, y, z, dx, dy, dz, yaw] = o.box;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      let u0 = Infinity, u1 = -Infinity;
      for (const [cx2, cy2] of [[dx / 2, dy / 2], [dx / 2, -dy / 2], [-dx / 2, -dy / 2], [-dx / 2, dy / 2]] as const) {
        const wy = cx2 * sn + cy2 * cs + y;
        const u = fx * (-wy / x) + cx;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      }
      const v0 = (fx * ((1.6 - z - dz / 2) / x) + cy) / CAM_H;
      const v1 = (fx * ((1.6 - z + dz / 2) / x) + cy) / CAM_H;
      return { id: o.id, label: o.label, conf: o.conf,
               u: u0 / CAM_W, v: Math.min(v0, v1), w: (u1 - u0) / CAM_W, h: Math.abs(v1 - v0) + 0.01 };
    });
}

function renderCam(pts: Float32Array, inten: Float32Array): Uint8Array {
  const img = new Uint8Array(CAM_W * CAM_H * 3).fill(14);
  const fx = CAM_W * 1.1, cx = CAM_W / 2, cy = CAM_H / 2;
  const stride = Math.max(1, Math.floor(pts.length / 3 / (CAM_W * CAM_H / 4)));
  for (let i = 0; i < pts.length / 3; i += stride) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    if (x <= 1 || Math.abs(y) > 35 || z < -1) continue;
    const u = Math.round(fx * (-y / x) + cx);
    const v = Math.round(fx * ((1.6 - z) / x) + cy);
    if (u < 0 || u >= CAM_W || v < 0 || v >= CAM_H) continue;
    const j = (v * CAM_W + u) * 3;
    const it = inten[i];
    img[j] = Math.max(img[j], (90 + 140 * it) | 0);
    img[j + 2] = Math.max(img[j + 2], (60 + 120 * it) | 0);
  }
  return img;
}

function randGauss(): number {
  let s = 0;
  for (let k = 0; k < 4; k++) s += rand();
  return (s - 2) / 1; // ~N(0, ~0.33)
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

self.onmessage = (e: MessageEvent<SimCommand>) => {
  const cmd = e.data;
  if (cmd.type === "init") {
    nPoints = cmd.n ?? nPoints;
    agents = spawn(scenario);
    if (!timer) timer = setInterval(emit, 1000 / FPS);
  } else if (cmd.type === "scenario") {
    scenario = cmd.scenario ?? "urban";
    agents = spawn(scenario);
    t = 0; frameIdx = 0;
  } else if (cmd.type === "points") {
    nPoints = Math.max(2000, Math.min(60000, cmd.n ?? nPoints));
  } else if (cmd.type === "pause") {
    paused = true;
  } else if (cmd.type === "resume") {
    paused = false;
  }
};

function emit() {
  if (paused) return;
  const f = step(1 / FPS);
  (self as unknown as Worker).postMessage(f, [f.positions.buffer, f.intensity.buffer, f.camRGB.buffer]);
}
