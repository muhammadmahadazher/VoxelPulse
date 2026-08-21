/** Data hub exporters: 4K snapshots, ROI-filtered .PLY / .PCD dumps. */
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

/** 4K clean snapshot (upscaled from the live framebuffer, no UI overlays). */
export function exportScreenshot() {
  const src = findWebglCanvas();
  if (!src) return;
  const out = document.createElement("canvas");
  out.width = 3840;
  out.height = Math.round((3840 / src.width) * src.height / 2) * 2;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  out.toBlob((b) => b && download(b, `voxelpulse-4k-${stamp()}.png`), "image/png");
}

/** Collect the display frame filtered by the active ROI crop bounds. */
function roiPoints(): { rows: string[][]; n: number } | null {
  const s = useStore.getState();
  const f = s.displayFrame();
  if (!f.n) return null;
  const { roi } = s;
  const rows: string[][] = [];
  for (let i = 0; i < f.n; i++) {
    const x = f.positions[i * 3], y = f.positions[i * 3 + 1], z = f.positions[i * 3 + 2];
    if (x < roi.xMin || x > roi.xMax || y < roi.yMin || y > roi.yMax || z < roi.zMin || z > roi.zMax)
      continue;
    rows.push([x.toFixed(3), y.toFixed(3), z.toFixed(3), f.intensity[i].toFixed(3)]);
  }
  return { rows, n: rows.length };
}

/** Export the ROI-filtered cloud to ascii .PLY. */
export function exportPly() {
  const data = roiPoints();
  if (!data || !data.n) return;
  const header =
    `ply\nformat ascii 1.0\ncomment VoxelPulse ROI export ${new Date().toISOString()}\n` +
    `element vertex ${data.n}\n` +
    `property float x\nproperty float y\nproperty float z\nproperty float intensity\nend_header\n`;
  const body = data.rows.map((r) => r.join(" ")).join("\n");
  download(new Blob([header, body], { type: "application/octet-stream" }), `voxelpulse-roi-${stamp()}.ply`);
}

/** Export the ROI-filtered cloud to ascii .PCD. */
export function exportPcd() {
  const data = roiPoints();
  if (!data || !data.n) return;
  const header =
    `# .PCD v0.7 - VoxelPulse ROI export\nVERSION 0.7\nFIELDS x y z intensity\n` +
    `SIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${data.n}\nHEIGHT 1\n` +
    `VIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${data.n}\nDATA ascii\n`;
  const body = data.rows.map((r) => r.join(" ")).join("\n");
  download(new Blob([header, body], { type: "application/octet-stream" }), `voxelpulse-roi-${stamp()}.pcd`);
}
