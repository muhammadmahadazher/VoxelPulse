import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Camera, Maximize2, Minimize2 } from "lucide-react";
import { useStore, type PipMode } from "../store";

const MODES: { id: PipMode; label: string }[] = [
  { id: "front", label: "FRONT" },
  { id: "rear", label: "REAR" },
  { id: "bev", label: "BEV" },
];

/** Picture-in-Picture sensor window: Front / Rear RGB + Bird's-Eye View radar. */
export function PiP() {
  const frame = useStore((s) => s.lastFrame);
  const mode = useStore((s) => s.pipMode);
  const large = useStore((s) => s.pipLarge);
  const setMode = useStore((s) => s.setPipMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame || frame.camW === 0) return;
    if (cv.width !== frame.camW) { cv.width = frame.camW; cv.height = frame.camH; }
    const ctx = cv.getContext("2d")!;

    if (mode === "bev") {
      // top-down orthographic scatter with range rings
      const W = frame.camW, H = frame.camH;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const scale = H / 2 / 60; // 60 m half-range
      const ox = W / 2, oy = H * 0.9;
      ctx.strokeStyle = "rgba(0,245,255,0.25)";
      for (const r of [10, 25, 50]) {
        ctx.beginPath();
        ctx.arc(ox, oy, r * scale, Math.PI, 2 * Math.PI);
        ctx.stroke();
      }
      for (let i = 0; i < frame.n; i += 5) {
        const x = frame.positions[i * 3], y = frame.positions[i * 3 + 1];
        const px = ox + y * scale, py = oy - x * scale;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const range = Math.hypot(x, y) / 70;
        ctx.fillStyle = `rgb(${(40 + 215 * range) | 0},${(180 - 120 * range) | 0},${(255 - 160 * range) | 0})`;
        ctx.fillRect(px, py, 1.2, 1.2);
      }
      // objects as rect outlines
      ctx.lineWidth = 1;
      for (const o of frame.objects) {
        const [ox2, oy2, , dx, dy, , yaw] = o.box;
        ctx.save();
        ctx.translate(ox + oy2 * scale, oy - ox2 * scale);
        ctx.rotate(-yaw);
        ctx.strokeStyle = o.label === "pedestrian" ? "#39FF6A" : "#00F5FF";
        ctx.strokeRect((-dy * scale) / 2, (-dx * scale) / 2, dy * scale, dx * scale);
        ctx.restore();
      }
      return;
    }

    const img = ctx.createImageData(frame.camW, frame.camH);
    const d = img.data, s = frame.camRGB;
    const mirror = mode === "rear";
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      const sj = mirror ? (frame.camW - 1 - ((j / 3) % frame.camW)) * 3 + Math.floor(j / 3 / frame.camW) * frame.camW * 3 : j;
      d[i] = s[sj]; d[i + 1] = s[sj + 1]; d[i + 2] = s[sj + 2]; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, mode]);

  return (
    <motion.div
      initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.15 }}
      className="glass absolute right-4 top-20 z-20 overflow-hidden rounded-xl p-2"
      style={{ width: large ? 340 : 264 }}
    >
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <Camera size={12} className="text-cyan" />
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`mono rounded px-1.5 py-0.5 text-[9px] tracking-wider transition ${
              mode === m.id ? "bg-cyan/20 text-cyan" : "text-slate-400 hover:text-slate-200"}`}>
            {m.label}
          </button>
        ))}
        <button onClick={() => useStore.getState().toggle("pipLarge")}
          className="ml-auto text-slate-400 hover:text-cyan" title="Resize">
          {large ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="w-full rounded-lg" />
        {mode !== "bev" &&
          frame?.objects2d.slice(0, 10).map((o) => (
            <div key={o.id} className="absolute rounded-sm"
              style={{
                left: `${(mode === "rear" ? 1 - o.u - o.w : o.u) * 100}%`, top: `${o.v * 100}%`,
                width: `${o.w * 100}%`, height: `${o.h * 100}%`,
                border: "1px solid #00F5FF", boxShadow: "0 0 6px rgba(0,245,255,0.5)",
              }}>
              <span className="mono absolute -top-4 left-0 whitespace-nowrap text-[9px] text-cyan">
                {o.label}
              </span>
            </div>
          ))}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px bg-cyan/20" />
          <div className="absolute top-1/2 left-0 h-px w-full bg-cyan/20" />
        </div>
      </div>
    </motion.div>
  );
}
