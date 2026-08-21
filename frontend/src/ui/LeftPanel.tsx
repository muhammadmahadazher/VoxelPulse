import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, ChevronLeft, Palette, CircleDot, Boxes } from "lucide-react";
import { useStore, type Colormap } from "../store";
import { sendCmd } from "../ws";

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <button onClick={onChange} className="flex w-full items-center justify-between py-1.5 text-left">
      <span className="text-xs text-slate-300">{label}</span>
      <span className={`relative h-4 w-8 rounded-full transition-colors ${checked ? "bg-cyan/70" : "bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function LeftPanel() {
  const [open, setOpen] = useState(true);
  const s = useStore();
  const maps: Colormap[] = ["turbo", "viridis", "cyber"];

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: -280, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }} transition={{ type: "spring", stiffness: 140, damping: 20 }}
            className="glass absolute left-4 top-20 z-20 w-56 rounded-xl p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <Layers size={14} className="text-cyan" />
              <span className="text-xs font-bold tracking-widest text-slate-200">LAYERS</span>
            </div>
            <Toggle label="Ground Plane" checked={s.showGround} onChange={() => s.toggle("showGround")} />
            <Toggle label="Bounding Boxes" checked={s.showBoxes} onChange={() => s.toggle("showBoxes")} />
            <Toggle label="Clusters" checked={s.showClusters} onChange={() => s.toggle("showClusters")} />

            <div className="mt-4 flex items-center gap-2">
              <CircleDot size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Point Size · {s.pointSize.toFixed(1)}</span>
            </div>
            <input type="range" min={0.5} max={5} step={0.1} value={s.pointSize}
              onChange={(e) => s.setPoint(+e.target.value)} className="mt-1 w-full" />

            <div className="mt-3 flex items-center gap-2">
              <Boxes size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Intensity ≥ {s.intensityMin.toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={0.95} step={0.05} value={s.intensityMin}
              onChange={(e) => s.setIntensity(+e.target.value)} className="mt-1 w-full" />

            <div className="mt-4 flex items-center gap-2">
              <Palette size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Colormap <kbd className="mono text-slate-500">C</kbd></span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {maps.map((m) => (
                <button key={m} onClick={() => s.setColormap(m)}
                  className={`mono flex-1 rounded-md border px-1 py-1 text-[9px] uppercase transition-all ${
                    s.colormap === m
                      ? "border-cyan text-cyan shadow-[0_0_8px_rgba(0,245,255,0.4)]"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                  {m}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-white/5 pt-3">
              <span className="text-[11px] text-slate-300">Cloud Density</span>
              <input type="range" min={5000} max={50000} step={5000} defaultValue={25000}
                onChange={(e) => sendCmd({ cmd: "set_points", n: +e.target.value })}
                className="mt-1 w-full" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(!open)}
        className="glass absolute top-20 z-20 flex h-10 w-6 items-center justify-center rounded-r-xl"
        style={{ left: open ? 244 : 8, transition: "left 0.3s" }}>
        <motion.span animate={{ rotate: open ? 0 : 180 }}>
          <ChevronLeft size={14} className="text-cyan" />
        </motion.span>
      </button>
    </>
  );
}
