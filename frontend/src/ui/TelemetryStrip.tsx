import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useStore } from "../store";

/** Bottom strip: range histogram sparkline + playback controls. */
export function TelemetryStrip() {
  const frame = useStore((s) => s.lastFrame);
  const paused = useStore((s) => s.paused);
  const toggle = useStore((s) => s.toggle);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame) return;
    const ctx = cv.getContext("2d")!;
    const W = (cv.width = cv.clientWidth * 2), H = (cv.height = cv.clientHeight * 2);
    ctx.clearRect(0, 0, W, H);
    const BINS = 40, MAXR = 80;
    const hist = new Array(BINS).fill(0);
    const p = frame.positions;
    for (let i = 0; i < frame.n; i += 7) { // stride-sample for cheap draw
      const r = Math.hypot(p[i * 3], p[i * 3 + 1]);
      const b = Math.min(BINS - 1, Math.floor((r / MAXR) * BINS));
      hist[b]++;
    }
    const max = Math.max(...hist, 1);
    const bw = W / BINS;
    for (let i = 0; i < BINS; i++) {
      const h = (hist[i] / max) * (H - 8);
      const grad = ctx.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, "#7000FF"); grad.addColorStop(1, "#00F5FF");
      ctx.fillStyle = grad;
      ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
    }
    ctx.strokeStyle = "rgba(148,163,184,0.5)";
    ctx.font = "18px monospace";
    ctx.fillStyle = "rgba(148,163,184,0.8)";
    ctx.fillText("range distribution (0–80 m)", 10, 24);
  }, [frame]);

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.25 }}
      className="glass absolute inset-x-4 bottom-4 z-20 flex h-20 items-center gap-4 rounded-xl px-4"
    >
      <div className="flex gap-2">
        <button onClick={() => toggle("paused")}
          className="rounded-lg border border-cyan/30 bg-cyan/10 p-2 text-cyan transition hover:bg-cyan/20">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button title="Regenerate scene"
          onClick={() => import("../ws").then((m) => m.sendCmd({ cmd: "regen" }))}
          className="rounded-lg border border-violet/40 bg-violet/10 p-2 text-violet-300 transition hover:bg-violet/20">
          <RotateCcw size={16} />
        </button>
      </div>
      <canvas ref={canvasRef} className="h-16 flex-1 rounded-lg" />
      <div className="mono hidden w-44 text-[10px] leading-relaxed text-slate-400 lg:block">
        <div>SPACE pause · R reset · T top-down · C colormap</div>
        <div className="text-slate-500">drag orbit · scroll zoom</div>
      </div>
    </motion.div>
  );
}
