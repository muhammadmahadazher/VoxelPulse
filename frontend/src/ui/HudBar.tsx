import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Radio, Gauge, Boxes, Zap, Wifi, Command } from "lucide-react";
import { useStore } from "../store";

function Chip({ icon, label, value, accent = "cyan" }: {
  icon: React.ReactNode; label: string; value: string; accent?: "cyan" | "violet" | "green" | "amber";
}) {
  const color = accent === "cyan" ? "#38BDF8" : accent === "violet" ? "#A78BFA" : accent === "green" ? "#34D399" : "#F59E0B";
  return (
    <div className="glass flex items-center gap-2 px-3 py-1.5">
      <span style={{ color }}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-widest text-slate-400">{label}</div>
        <div className="mono text-sm font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

const MODE_LABEL: Record<string, string> = {
  connecting: "CONNECTING", live: "LIVE SENSOR", sim: "SIM ENGINE", file: "FILE PLAYBACK",
};

export function HudBar() {
  const { fps, latencyMs, lastFrame, connected, mode } = useStore();
  const [health, setHealth] = useState<{ sensors: { id: string }[] } | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [mode]);

  const n = lastFrame?.n ?? 0;
  const modeAccent = mode === "live" ? "green" : mode === "sim" ? "violet" : "amber";
  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4"
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        <div className="glass flex items-center gap-2 px-4 py-2">
          <Boxes size={18} className="text-sky-400" />
          <span className="text-sm font-black tracking-wider text-slate-100">
            VOXEL<span className="text-sky-400">PULSE</span>
          </span>
          <span className="mono rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400">v3.0 STUDIO</span>
        </div>
        <Chip icon={<Activity size={14} />} label="FPS" value={fps.toFixed(0)} accent="green" />
        <Chip icon={<Radio size={14} />} label="Points" value={n.toLocaleString()} />
        <Chip icon={<Gauge size={14} />} label="Latency" value={`${latencyMs.toFixed(0)} ms`} accent="violet" />
        <Chip icon={<Zap size={14} />} label="Tracks" value={String(lastFrame?.objects.length ?? 0)} accent="amber" />
        <Chip icon={<Wifi size={14} />} label="Mode" value={MODE_LABEL[mode] ?? mode} accent={modeAccent as "green"} />
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        {(mode === "live" ? health?.sensors ?? [] : [{ id: "sim-lidar" }, { id: "sim-cam" }]).map((s) => (
          <div key={s.id} className="glass flex items-center gap-1.5 px-3 py-1.5">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
            <span className="mono text-[10px] text-slate-300">{s.id}</span>
          </div>
        ))}
        <button onClick={() => useStore.getState().toggle("paletteOpen")}
          className="glass flex items-center gap-1.5 px-3 py-1.5 text-slate-300 transition hover:text-sky-300">
          <Command size={12} />
          <kbd className="mono text-[10px]">Ctrl K</kbd>
        </button>
      </div>
    </motion.div>
  );
}
