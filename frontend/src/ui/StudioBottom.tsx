import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Pause, Play, SkipBack, SkipForward, Repeat, Camera, FileDown, Gauge, Radio,
} from "lucide-react";
import { useStore } from "../store";
import { exportScreenshot, exportPly, exportPcd } from "../utils/exporters";
import { setSimScenario, setStreamPaused } from "../ws";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** Sparkline for one telemetry series. */
function Spark({ series, color, label, unit, max }: {
  series: number[]; color: string; label: string; unit: string; max?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const W = (cv.width = cv.clientWidth * 2), H = (cv.height = cv.clientHeight * 2);
    ctx.clearRect(0, 0, W, H);
    if (series.length < 2) return;
    const hi = max ?? Math.max(...series, 1e-6);
    const lo = 0;
    const pt = (i: number): [number, number] => [
      (i / (series.length - 1)) * W,
      H - 4 - ((series[i] - lo) / (hi - lo)) * (H - 10),
    ];
    ctx.beginPath();
    const first = pt(0);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < series.length; i++) {
      const p = pt(i);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // fill
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + "44"); grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill();
    const last = series[series.length - 1];
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.font = "16px monospace";
    ctx.fillText(`${label} ${last.toFixed(last < 10 ? 1 : 0)}${unit}`, 8, 20);
  }, [series, color, label, unit, max]);
  return <canvas ref={ref} className="h-9 w-full" />;
}

/** Volumetric density heatmap (BEV x-y bins) overlay. */
function DensityHeatmap() {
  const show = useStore((s) => s.showDensity);
  const frame = useStore((s) => s.lastFrame);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!show) return;
    const cv = ref.current;
    if (!cv || !frame) return;
    const N = 80;
    if (cv.width !== N) { cv.width = N; cv.height = N / 2; }
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, N, N / 2);
    const bins = new Float32Array(N * (N / 2));
    let maxBin = 1;
    for (let i = 0; i < frame.n; i += 3) {
      const x = frame.positions[i * 3], y = frame.positions[i * 3 + 1];
      const bx = Math.min(N - 1, Math.max(0, Math.floor(((x + 10) / 90) * N)));
      const by = Math.min(N / 2 - 1, Math.max(0, Math.floor(((y + 40) / 80) * (N / 2))));
      const k = by * N + bx;
      bins[k]++;
      if (bins[k] > maxBin) maxBin = bins[k];
    }
    const img = ctx.createImageData(N, N / 2);
    for (let k = 0; k < bins.length; k++) {
      const t = Math.pow(bins[k] / maxBin, 0.4);
      const j = k * 4;
      img.data[j] = (10 + 240 * t) | 0;
      img.data[j + 1] = (12 + 120 * t) | 0;
      img.data[j + 2] = (20 + 40 * t) | 0;
      img.data[j + 3] = t > 0.02 ? 255 : 40;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, show]);
  if (!show) return null;
  return (
    <div className="glass flex flex-col items-center gap-1 rounded-lg border-white/10 p-1.5">
      <span className="mono text-[8px] uppercase tracking-wider text-slate-500">density</span>
      <canvas ref={ref} className="h-14 w-28 rounded" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

/** Bottom studio: synchronized timeline scrubber + telemetry time-series. */
export function StudioBottom() {
  const { paused, scrub, history, playSpeed, stats, mode, scenario } = useStore();
  const toggle = useStore((s) => s.toggle);
  const setScrub = useStore((s) => s.setScrub);
  const setPlaySpeed = useStore((s) => s.setPlaySpeed);

  // timeline replay ticker
  useEffect(() => {
    if (!scrub.active || paused) return;
    const iv = setInterval(() => {
      const s = useStore.getState();
      const next = s.scrub.index + 1;
      if (next >= s.history.length) {
        if (s.playSpeed > 0) s.setScrub(true, 0); // loop
      } else s.setScrub(true, next);
    }, 1000 / 30 / playSpeed);
    return () => clearInterval(iv);
  }, [scrub.active, paused, playSpeed, scrub.index]);

  const statsArr = stats.slice(-60);
  const iconBtn = "rounded-md border p-1.5 transition";

  return (
    <motion.div
      initial={{ y: 90, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.2 }}
      className="glass absolute inset-x-3 bottom-3 z-20 flex h-24 items-center gap-3 rounded-xl border-white/10 px-3"
    >
      {/* transport */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex gap-1.5">
          <button
            onClick={() => {
              const s = useStore.getState();
              if (scrub.active) { setScrub(false, 0); toggle("paused"); setStreamPaused(false); }
              else { toggle("paused"); setStreamPaused(!s.paused ? true : false); }
            }}
            className={`${iconBtn} border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20`}
            title="Play / Pause (Space)">
            {paused && !scrub.active ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button disabled={!history.length}
            onClick={() => setScrub(true, Math.max(0, scrub.index - 1))}
            className={`${iconBtn} border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30`}
            title="Step back">
            <SkipBack size={14} />
          </button>
          <button disabled={!history.length}
            onClick={() => setScrub(true, Math.min(history.length - 1, scrub.index + 1))}
            className={`${iconBtn} border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30`}
            title="Step forward">
            <SkipForward size={14} />
          </button>
          <button onClick={() => setScrub(true, 0)} disabled={!history.length}
            className={`${iconBtn} border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30`}
            title="Loop from start">
            <Repeat size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Gauge size={10} className="text-slate-500" />
          {SPEEDS.map((sp) => (
            <button key={sp} onClick={() => setPlaySpeed(sp)}
              className={`mono rounded px-1 text-[9px] ${playSpeed === sp ? "bg-amber-500/20 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {sp}×
            </button>
          ))}
          <button onClick={() => { setScrub(false, 0); useStore.getState().setPlaySpeed(1); }}
            className={`mono ml-1 rounded px-1.5 text-[9px] font-bold tracking-wider ${
              scrub.active ? "bg-sky-400/20 text-sky-300" : "bg-emerald-400/20 text-emerald-300"}`}>
            {scrub.active ? "REPLAY" : "LIVE"}
          </button>
        </div>
      </div>

      {/* scrubber */}
      <div className="flex h-full min-w-0 flex-1 flex-col justify-center gap-1">
        <input
          type="range" min={0} max={Math.max(0, history.length - 1)} value={scrub.index}
          disabled={!history.length}
          onChange={(e) => setScrub(true, +e.target.value)}
          className="w-full disabled:opacity-40"
        />
        <div className="mono flex justify-between text-[8px] text-slate-500">
          <span>{scrub.active ? `REPLAY ${scrub.index + 1}/${history.length}` : `LIVE · buffer ${history.length}f`}</span>
          <span>{mode.toUpperCase()} · {scenario.toUpperCase()}</span>
        </div>
      </div>

      {/* time-series */}
      <div className="hidden h-full min-w-0 flex-1 grid-cols-4 gap-2 lg:grid">
        <Spark series={statsArr.map((s) => s.fps)} color="#34D399" label="FPS" unit="" max={40} />
        <Spark series={statsArr.map((s) => s.latency)} color="#A78BFA" label="LAT" unit="ms" />
        <Spark series={statsArr.map((s) => s.points)} color="#38BDF8" label="PTS" unit="" />
        <Spark series={statsArr.map((s) => s.tracks)} color="#F59E0B" label="TRK" unit="" max={20} />
      </div>

      <DensityHeatmap />

      {/* export */}
      <div className="flex flex-col gap-1.5">
        <button onClick={exportScreenshot} title="4K snapshot (S)"
          className={`${iconBtn} border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20`}>
          <Camera size={14} />
        </button>
        <button onClick={exportPly} title="Export ROI .PLY (E)"
          className={`${iconBtn} border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20`}>
          <FileDown size={14} />
        </button>
        <button onClick={exportPcd} title="Export ROI .PCD"
          className={`${iconBtn} border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20`}>
          <Radio size={14} />
        </button>
      </div>
    </motion.div>
  );
}
