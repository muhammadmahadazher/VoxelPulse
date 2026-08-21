/** Client-side point cloud file parsing for .ply / .pcd / .xyz drop targets. */
import type { FrameData } from "../store";
import { EMPTY_FRAME } from "../store";

const MAX_LOAD_POINTS = 400_000;

export function parsePointFile(name: string, buf: ArrayBuffer): FrameData {
  const lower = name.toLowerCase();
  if (lower.endsWith(".ply")) return fromPly(buf);
  if (lower.endsWith(".pcd")) return fromPcd(buf);
  if (lower.endsWith(".las")) return fromLas(buf);
  if (lower.endsWith(".laz"))
    throw new Error(".laz is compressed LAS — convert to .las or upload via the backend");
  if (lower.endsWith(".xyz") || lower.endsWith(".txt") || lower.endsWith(".pts"))
    return fromXyz(new TextDecoder().decode(buf));
  throw new Error(`unsupported file type: ${name}`);
}

/** Binary LAS 1.x: point count @107, point data offset @96, xyz as scaled i32. */
function fromLas(buf: ArrayBuffer): FrameData {
  const dv = new DataView(buf);
  if (dv.byteLength < 120) throw new Error("bad LAS: too short");
  const n = Math.min(dv.getUint32(107, true), MAX_LOAD_POINTS);
  const offset = dv.getUint32(96, true);
  const scale = 0.001;
  const positions = new Float32Array(n * 3);
  const intensity = new Float32Array(n);
  const bytes = new Uint8Array(buf);
  const fmt = dv.getUint8(106) & 0x7f;
  const recLen = fmt === 1 || fmt === 4 || fmt === 5 ? (fmt === 5 ? 28 : fmt === 4 ? 29 : 20)
    : fmt === 2 || fmt === 3 ? (fmt === 3 ? 26 : 20) : 20;
  for (let i = 0; i < n; i++) {
    const base = offset + i * recLen;
    if (base + 12 > bytes.length) break;
    positions[i * 3] = dv.getInt32(base, true) * scale;
    positions[i * 3 + 1] = dv.getInt32(base + 4, true) * scale;
    positions[i * 3 + 2] = dv.getInt32(base + 8, true) * scale;
    intensity[i] = 0.5;
  }
  // recenter around origin for comfortable viewing
  const m = n >> 1;
  if (n > 1) {
    const cx = positions[m * 3], cy = positions[m * 3 + 1], cz = positions[m * 3 + 2];
    for (let i = 0; i < n; i++) {
      positions[i * 3] -= cx; positions[i * 3 + 1] -= cy; positions[i * 3 + 2] -= cz;
    }
  }
  return { ...EMPTY_FRAME, n, ts: Date.now(), positions, intensity };
}

function fromPly(buf: ArrayBuffer): FrameData {
  const bytes = new Uint8Array(buf);
  const marker = new TextEncoder().encode("end_header\n");
  let bodyStart = -1;
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++)
      if (bytes[i + j] !== marker[j]) continue outer;
    bodyStart = i + marker.length;
    break;
  }
  if (bodyStart === -1) throw new Error("bad PLY: no end_header");
  const header = new TextDecoder().decode(bytes.slice(0, bodyStart));
  const nMatch = header.match(/element vertex (\d+)/);
  if (!nMatch) throw new Error("bad PLY: no vertex count");
  const n = Math.min(parseInt(nMatch[1], 10), MAX_LOAD_POINTS);
  const hasIntensity = /property float (intensity|i)\b/.test(header);
  const stride = hasIntensity ? 4 : 3;
  const f32 = new Float32Array(buf, bodyStart, n * stride);
  const positions = new Float32Array(n * 3);
  const intensity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = f32[i * stride];
    positions[i * 3 + 1] = f32[i * stride + 1];
    positions[i * 3 + 2] = f32[i * stride + 2];
    intensity[i] = hasIntensity ? Math.min(1, Math.max(0, f32[i * stride + 3])) : 0.5;
  }
  return { ...EMPTY_FRAME, n, ts: Date.now(), positions, intensity };
}

function fromPcd(buf: ArrayBuffer): FrameData {
  const text = new TextDecoder().decode(buf);
  const nMatch = text.match(/^POINTS (\d+)$/m);
  if (!nMatch) throw new Error("bad PCD: no POINTS");
  const dataMatch = text.match(/^DATA (\w+)$/m);
  const format = dataMatch?.[1] ?? "ascii";
  if (format === "ascii") return fromXyz(text);
  const n = Math.min(parseInt(nMatch[1], 10), MAX_LOAD_POINTS);
  const bodyStart = findDataOffset(new Uint8Array(buf));
  const f32 = new Float32Array(buf, bodyStart, n * 3);
  return {
    ...EMPTY_FRAME, n, ts: Date.now(),
    positions: new Float32Array(f32),
    intensity: new Float32Array(n).fill(0.5),
  };
}

function findDataOffset(bytes: Uint8Array): number {
  let idx = 0;
  for (let lines = 0; lines < 20 && idx < bytes.length; lines++) {
    const nl = bytes.indexOf(10, idx);
    if (nl === -1) return 0;
    const line = new TextDecoder().decode(bytes.slice(idx, nl));
    idx = nl + 1;
    if (line.startsWith("DATA")) return idx;
  }
  return 0;
}

function fromXyz(text: string): FrameData {
  const lines = text.split(/\r?\n/);
  const positions: number[] = [];
  const intensity: number[] = [];
  for (const line of lines) {
    if (positions.length / 3 >= MAX_LOAD_POINTS) break;
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]), y = parseFloat(parts[1]), z = parseFloat(parts[2]);
    if ([x, y, z].some(Number.isNaN)) continue;
    positions.push(x, y, z);
    intensity.push(parts.length > 3 ? Math.min(1, Math.max(0, parseFloat(parts[3]) || 0.5)) : 0.5);
  }
  const n = positions.length / 3;
  if (!n) throw new Error("no points parsed from ascii file");
  return {
    ...EMPTY_FRAME, n, ts: Date.now(),
    positions: new Float32Array(positions), intensity: new Float32Array(intensity),
  };
}
