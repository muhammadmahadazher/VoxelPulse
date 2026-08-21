/** Session recording & snapshot exporters: watermarked PNG + .PLY point dump. */
import { useStore } from "../store";

function findWebglCanvas(): HTMLCanvasElement | null {
  for (const c of Array.from(document.getElementsByTagName("canvas"))) {
    const ctx = c.getContext("webgl2") ?? c.getContext("webgl");
    if (ctx) return c;
  }
  return null;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** High-res canvas screenshot with embedded telemetry watermark. */
export function exportScreenshot() {
  const src = findWebglCanvas();
  if (!src) return;
  const s = useStore.getState();
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  // telemetry watermark
  const meta = [
    "VOXELPULSE · REAL-TIME 3D SENSOR FUSION",
    `${new Date().toISOString()}   mode=${s.mode}   colormap=${s.colormap}`,
    `points=${s.lastFrame?.n ?? 0}   fps=${s.fps.toFixed(0)}   latency=${s.latencyMs.toFixed(0)}ms   tracks=${s.lastFrame?.objects.length ?? 0}`,
  ];
  const pad = Math.round(out.width * 0.012);
  ctx.font = `${Math.max(11, Math.round(out.width / 110))}px monospace`;
  meta.forEach((line, i) => {
    const y = out.height - pad - (meta.length - 1 - i) * Math.max(16, out.width / 70);
    ctx.fillStyle = "rgba(9,10,15,0.72)";
    ctx.fillRect(pad - 6, y - Math.max(12, out.width / 90), ctx.measureText(line).width + 12, Math.max(16, out.width / 60));
    ctx.fillStyle = i === 0 ? "#00F5FF" : "rgba(226,232,240,0.9)";
    ctx.fillText(line, pad, y);
  });
  out.toBlob((b) => b && download(b, `voxelpulse-${stamp()}.png`), "image/png");
}

/** Export the current (ROI/identity — full) frame to binary .ply. */
export function exportPly() {
  const s = useStore.getState();
  const f = s.lastFrame;
  if (!f || !f.n) return;
  const header =
    `ply\nformat ascii 1.0\ncomment VoxelPulse export ${new Date().toISOString()}\n` +
    `element vertex ${f.n}\n` +
    `property float x\nproperty float y\nproperty float z\nproperty float intensity\nend_header\n`;
  const rows = new Array<string>(f.n);
  for (let i = 0; i < f.n; i++) {
    rows[i] = `${f.positions[i * 3].toFixed(3)} ${f.positions[i * 3 + 1].toFixed(3)} ${f.positions[i * 3 + 2].toFixed(3)} ${f.intensity[i].toFixed(3)}`;
  }
  download(new Blob([header, rows.join("\n")], { type: "application/octet-stream" }), `voxelpulse-${stamp()}.ply`);
}
