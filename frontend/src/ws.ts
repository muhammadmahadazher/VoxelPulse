import { useStore, type FrameData } from "./store";

const MAGIC = 0x31465056; // "VPF1" little-endian
const textDecoder = new TextDecoder();

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

export function connectStream(url = `ws://${location.host}/ws/stream`) {
  const store = useStore.getState();
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => store.setConnected(true);
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    setTimeout(() => connectStream(url), 2000); // auto-reconnect
  };
  let last = performance.now();
  let fpsAcc = 0, frames = 0;

  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (dt <= 0 || dt > 1000) return;
    try {
      const frame = parseFrame(ev.data);
      frames++;
      fpsAcc += 1000 / dt;
      if (frames >= 15) {
        useStore.getState().setStats(fpsAcc / frames, Math.max(0, performance.now() - frame.ts * 1000));
        fpsAcc = 0; frames = 0;
      }
      if (!useStore.getState().paused) useStore.getState().setFrame(frame);
    } catch {
      /* drop malformed frame */
    }
  };
  (window as unknown as { __vpws: WebSocket }).__vpws = ws;
  return ws;
}

export function sendCmd(cmd: Record<string, unknown>) {
  const ws = (window as unknown as { __vpws?: WebSocket }).__vpws;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
}
