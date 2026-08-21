import { useStore, type FrameData, estimateVelocities } from "./store";
import type { SimCommand, SimFrameMsg, ScenarioName } from "./sim/types";

const MAGIC = 0x31465056; // "VPF1" little-endian
const textDecoder = new TextDecoder();

let simWorker: Worker | null = null;
let ws: WebSocket | null = null;

/** Parses one binary frame: header JSON + positions f32 + intensity f32 + cam rgb. */
export function parseFrame(buf: ArrayBuffer): FrameData {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("bad frame magic");
  const headerLen = dv.getUint16(4, true);
  const hdr = JSON.parse(textDecoder.decode(new Uint8Array(buf, 6, headerLen)));
  const n = hdr.n as number;
  const pos = new Float32Array(buf, 6 + headerLen, n * 3);
  const inten = new Float32Array(buf, 6 + headerLen + n * 12, n);
  const cam = new Uint8Array(buf, 6 + headerLen + n * 16, hdr.cam_w * hdr.cam_h * 3);
  return {
    n, ts: hdr.ts, objects: hdr.objects, objects2d: hdr.objects2d,
    positions: pos, intensity: inten,
    camW: hdr.cam_w, camH: hdr.cam_h, camRGB: cam,
  };
}

function ingest(frame: FrameData) {
  estimateVelocities(frame);
  if (useStore.getState().mode === "live") {
    useStore.getState().setStats(useStore.getState().fps, Math.max(0, Date.now() - frame.ts));
  }
  if (!useStore.getState().paused) useStore.getState().setFrame(frame);
}

let last = performance.now();
let fpsAcc = 0, frames = 0;
function statsTick() {
  const now = performance.now();
  const dt = now - last;
  last = now;
  if (dt <= 0 || dt > 1000) return false;
  frames++;
  fpsAcc += 1000 / dt;
  if (frames >= 15) {
    useStore.getState().setStats(fpsAcc / frames, useStore.getState().latencyMs);
    fpsAcc = 0; frames = 0;
  }
  return true;
}

// ---------------------------------------------------------------- live mode
export function connectStream(url = `ws://${location.host}/ws/stream`) {
  if (new URLSearchParams(location.search).get("mode") === "sim") {
    startSim();
    return;
  }
  const s = useStore.getState();
  s.setMode("connecting");

  let gotFrame = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    startSim();
    return;
  }
  ws = socket;
  socket.binaryType = "arraybuffer";
  const failTimer = setTimeout(() => {
    if (!gotFrame) {
      socket.close();
      startSim();
    }
  }, 3000);

  socket.onopen = () => useStore.getState().setConnected(true);
  socket.onmessage = (ev) => {
    if (typeof ev.data === "string") return;
    if (!gotFrame) {
      gotFrame = true;
      clearTimeout(failTimer);
      stopSim();
      useStore.getState().setMode("live");
    }
    if (!statsTick()) return;
    try {
      ingest(parseFrame(ev.data));
    } catch {
      /* drop malformed frame */
    }
  };
  socket.onclose = () => {
    useStore.getState().setConnected(false);
    clearTimeout(failTimer);
    // static hosting or backend down -> seamless standalone simulation
    if (!gotFrame || useStore.getState().mode !== "live") startSim();
    else setTimeout(() => connectStream(url), 2000);
  };
  socket.onerror = () => { /* handled by onclose */ };
}

export function sendCmd(cmd: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  if (simWorker && typeof cmd.n === "number")
    simWorker.postMessage({ type: "points", n: cmd.n } satisfies SimCommand);
}

// ---------------------------------------------------------------- sim mode
export function startSim() {
  if (simWorker) return;
  const s = useStore.getState();
  s.setMode("sim");
  s.setConnected(true);
  simWorker = new Worker(new URL("./sim/simWorker.ts", import.meta.url), { type: "module" });
  simWorker.onmessage = (e: MessageEvent<SimFrameMsg>) => {
    const f = e.data;
    if (!statsTick()) return;
    ingest({
      n: f.n, ts: f.ts, objects: f.objects, objects2d: f.objects2d,
      positions: f.positions, intensity: f.intensity,
      camW: f.camW, camH: f.camH, camRGB: f.camRGB,
    });
  };
  simWorker.postMessage({ type: "init", n: 25000 } satisfies SimCommand);
  simWorker.postMessage({ type: "scenario", scenario: s.scenario } satisfies SimCommand);
}

export function stopSim() {
  simWorker?.terminate();
  simWorker = null;
}

export function setSimScenario(scenario: ScenarioName) {
  useStore.getState().setScenario(scenario);
  if (useStore.getState().mode === "sim" && simWorker) {
    simWorker.postMessage({ type: "scenario", scenario } satisfies SimCommand);
  } else if (useStore.getState().mode === "live" && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ cmd: "regen" }));
  }
}

export function setStreamPaused(paused: boolean) {
  simWorker?.postMessage({ type: paused ? "pause" : "resume" } satisfies SimCommand);
}

/** Replace live stream with a locally parsed file frame (drag & drop). */
export function loadStaticFrame(frame: FrameData, name: string) {
  stopSim();
  ws?.close();
  useStore.setState({ mode: "file", connected: false, paused: true });
  useStore.getState().setFrame(frame);
  console.info(`[VoxelPulse] loaded ${name}: ${frame.n} points`);
}
