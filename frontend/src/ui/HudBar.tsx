import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Radio, Gauge, Boxes, Zap, Wifi } from "lucide-react";
import { useStore } from "../store";

function Chip({ icon, label, value, accent = "cyan" }: {
  icon: React.ReactNode; label: string; value: string; accent?: "cyan" | "violet" | "green";
}) {
  const color = accent === "cyan" ? "#00F5FF" : accent === "violet" ? "#A78BFA" : "#39FF6A";
  return (
    <div className="glass flex items-center gap-2 px-3 py-1.5">
      <span style={{ color }}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-widest text-slate-400">{label}</div>
        <div className="mono text-sm font-bold glow-cyan" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

export function HudBar() {
  const { fps, latencyMs, lastFrame, connected, frameCount } = useStore();
  const [health, setHealth] = useState<{ sensors: { id: string; type: string; status: string }[] } | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const n = lastFrame?.n ?? 0;
  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4"
    >
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="glass flex items-center gap-2 px-4 py-2">
          <Boxes size={18} className="text-cyan" />
          <span className="text-sm font-black tracking-wider text-slate-100">
            VOXEL<span className="text-cyan glow-cyan">PULSE</span>
          </span>
        </div>
        <Chip icon={<Activity size={14} />} label="FPS" value={fps.toFixed(0)} accent="green" />
        <Chip icon={<Radio size={14} />} label="Points" value={n.toLocaleString()} />
        <Chip icon={<Gauge size={14} />} label="Latency" value={`${latencyMs.toFixed(0)} ms`} accent="violet" />
        <Chip icon={<Zap size={14} />} label="Frames" value={String(frameCount)} />
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        {(health?.sensors ?? []).map((s) => (
          <div key={s.id} className="glass flex items-center gap-1.5 px-3 py-1.5">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}
              ${connected ? "animate-pulse" : ""}`} />
            <span className="mono text-[10px] text-slate-300">{s.id}</span>
          </div>
        ))}
        <div className="glass flex items-center gap-1.5 px-3 py-1.5">
          <Wifi size={12} className={connected ? "text-emerald-400" : "text-red-500"} />
          <span className="mono text-[10px]">{connected ? "LINK OK" : "OFFLINE"}</span>
        </div>
      </div>
    </motion.div>
  );
}
