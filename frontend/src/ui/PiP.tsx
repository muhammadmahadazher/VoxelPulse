import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Camera, Maximize2, Minimize2 } from "lucide-react";
import { useStore, type PipMode } from "../store";

const MODES: { id: PipMode; label: string }[] = [
  { id: "front", label: "FRONT" },
  { id: "rear", label: "REAR" },
  { id: "bev", label: "BEV" },
];

/** Camera 01 sensor window: Front / Rear RGB + Bird's-Eye View radar.
 *  Renders docked (inline) inside the inspector or as a floating PiP. */
export function PiP({ inline = false }: { inline?: boolean }) {
  const frame = useStore((s) => s.lastFrame);
  const mode = useStore((s) => s.pipMode);
  const large = useStore((s) => s.pipLarge);
  const setMode = useStore((s) => s.setPipMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame || frame.camW === 0) return;
    if (cv.width !== frame.camW || cv.height !== frame.camH) {
      cv.width = frame.camW; cv.height = frame.camH;
    }
    const ctx = cv.getContext("2d")!;

    if (mode === "bev") {
      const W = frame.camW, H = frame.camH;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const scale = H / 2 / 60;
      const ox = W / 2, oy = H * 0.9;
      ctx.strokeStyle = "rgba(56,189,248,0.25)";
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
        ctx.fillStyle = `rgb(${(40 + 215 * range) | 0},${(150 - 90 * range) | 0},${(248 - 150 * range) | 0})`;
        ctx.fillRect(px, py, 1.2, 1.2);
      }
      ctx.lineWidth = 1;
      for (const o of frame.objects) {
        const [ox2, oy2, , dx, dy, , yaw] = o.box;
        ctx.save();
        ctx.translate(ox + oy2 * scale, oy - ox2 * scale);
        ctx.rotate(-yaw);
        ctx.strokeStyle = o.label === "pedestrian" ? "#34D399" : "#38BDF8";
        ctx.strokeRect((-dy * scale) / 2, (-dx * scale) / 2, dy * scale, dx * scale);
        ctx.restore();
      }
      return;
    }

    const img = ctx.createImageData(frame.camW, frame.camH);
    const d = img.data, s = frame.camRGB;
    const mirror = mode === "rear";
    const rowLen = frame.camW * 3;
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      const row = Math.floor(j / rowLen);
      const col = (j / 3) % frame.camW;
      const srcCol = mirror ? frame.camW - 1 - col : col;
      const sj = row * rowLen + srcCol * 3;
      d[i] = s[sj]; d[i + 1] = s[sj + 1]; d[i + 2] = s[sj + 2]; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, mode]);

  const body = (
    <div
      className={
        inline
          ? "overflow-hidden rounded-[var(--vp-r-md)] border"
          : "vp-panel absolute right-3 top-16 z-20 overflow-hidden rounded-[var(--vp-r-lg)] border p-2"
      }
      style={!inline ? { width: large ? 340 : 264 } : undefined}
    >
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: "var(--vp-divider)" }}>
        <Camera size={12} className="text-[var(--vp-accent)]" />
        <span className="text-[11px] font-semibold text-[var(--vp-text-2)]">CAM 01</span>
        <div className="ml-auto flex items-center gap-0.5">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`vp-focusable rounded-[var(--vp-r-sm)] px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider transition-colors
                ${mode === m.id
                  ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]"
                  : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"}`}>
              {m.label}
            </button>
          ))}
          {!inline && (
            <button onClick={() => useStore.getState().toggle("pipLarge")}
              className="ml-1 text-[var(--vp-text-3)] hover:text-[var(--vp-accent)]" title="Resize">
              {large ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
        </div>
      </div>
      <div className="relative aspect-[4/3] w-full bg-black/50">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
        {mode !== "bev" &&
          frame?.objects2d.slice(0, 10).map((o) => (
            <div key={o.id} className="absolute rounded-sm"
              style={{
                left: `${(mode === "rear" ? 1 - o.u - o.w : o.u) * 100}%`, top: `${o.v * 100}%`,
                width: `${o.w * 100}%`, height: `${o.h * 100}%`,
                border: "1px solid var(--vp-accent)",
              }} />
          ))}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px" style={{ background: "rgba(125,165,220,0.25)" }} />
          <div className="absolute top-1/2 left-0 h-px w-full" style={{ background: "rgba(125,165,220,0.25)" }} />
        </div>
      </div>
    </div>
  );

  if (inline) return body;
  return (
    <motion.div
      initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.15 }}
    >
      {body}
    </motion.div>
  );
}
