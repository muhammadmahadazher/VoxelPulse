import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play, RotateCcw, Camera, FileDown, UploadCloud } from "lucide-react";
import { useStore } from "../store";
import { exportScreenshot, exportPly } from "../utils/exporters";
import { setSimScenario } from "../ws";

/** Bottom strip: range histogram, playback controls, snapshot & export actions. */
export function TelemetryStrip() {
  const frame = useStore((s) => s.lastFrame);
  const paused = useStore((s) => s.paused);
  const toggle = useStore((s) => s.toggle);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame) return;
    const ctx = cv.getContext("2d")!;
    const W = (cv.width = cv.clientWidth * 2), H = (cv.height = cv.clientHeight * 2);
    ctx.clearRect(0, 0, W, H);
    const BINS = 40, MAXR = 80;
    const hist = new Array(BINS).fill(0);
    const p = frame.positions;
    for (let i = 0; i < frame.n; i += 7) {
      const r = Math.hypot(p[i * 3], p[i * 3 + 1]);
      hist[Math.min(BINS - 1, Math.floor((r / MAXR) * BINS))]++;
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
    ctx.fillStyle = "rgba(148,163,184,0.8)";
    ctx.font = "18px monospace";
    ctx.fillText("range distribution (0–80 m)", 10, 24);
  }, [frame]);

  const iconBtn = "rounded-lg border p-2 transition";
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.25 }}
      className="glass absolute inset-x-4 bottom-4 z-20 flex h-20 items-center gap-3 rounded-xl px-4"
    >
      <div className="flex gap-2">
        <button onClick={() => toggle("paused")} title="Play/Pause (Space)"
          className={`${iconBtn} border-cyan/30 bg-cyan/10 text-cyan hover:bg-cyan/20`}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button onClick={() => setSimScenario(useStore.getState().scenario)} title="Regenerate scene"
          className={`${iconBtn} border-violet/40 bg-violet/10 text-violet-300 hover:bg-violet/20`}>
          <RotateCcw size={16} />
        </button>
        <button onClick={() => { exportScreenshot(); flash("snapshot saved"); }} title="Screenshot PNG (S)"
          className={`${iconBtn} border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20`}>
          <Camera size={16} />
        </button>
        <button onClick={() => { exportPly(); flash(".ply exported"); }} title="Export .PLY (E)"
          className={`${iconBtn} border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20`}>
          <FileDown size={16} />
        </button>
      </div>
      <canvas ref={canvasRef} className="h-16 min-w-0 flex-1 rounded-lg" />
      {toast && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="mono absolute -top-8 right-4 rounded-md border border-cyan/30 bg-[#0b0d16]/90 px-2 py-1 text-[10px] text-cyan">
          {toast}
        </motion.div>
      )}
      <div className="mono hidden w-52 text-[10px] leading-relaxed text-slate-400 xl:block">
        <div className="flex items-center gap-1"><UploadCloud size={10} className="text-cyan" /> drop .ply/.pcd/.xyz to load</div>
        <div className="text-slate-500">SPACE pause · R reset · T top · M ruler · ⌘K palette</div>
      </div>
    </motion.div>
  );
}
