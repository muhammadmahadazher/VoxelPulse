import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, ChevronLeft, Palette, CircleDot, Boxes, Crop, Scissors } from "lucide-react";
import { useStore, COLORMAPS } from "../store";
import { sendCmd, setSimScenario } from "../ws";
import type { ScenarioName } from "../store";

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: () => void;
}) {
  return (
    <button onClick={onChange} className="flex w-full items-center justify-between py-1.5 text-left">
      <span className="text-xs text-slate-300">
        {label}
        {hint && <kbd className="mono ml-1 text-[9px] text-slate-500">{hint}</kbd>}
      </span>
      <span className={`relative h-4 w-8 rounded-full transition-colors ${checked ? "bg-cyan/70" : "bg-slate-700"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Range({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-2">
      <span className="text-[11px] text-slate-300">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)} className="mt-1 w-full" />
    </div>
  );
}

const SCENARIOS: { id: ScenarioName; label: string }[] = [
  { id: "urban", label: "Urban" },
  { id: "warehouse", label: "Warehouse" },
  { id: "drone", label: "Drone" },
];

export function LeftPanel() {
  const [open, setOpen] = useState(true);
  const [roiOpen, setRoiOpen] = useState(false);
  const s = useStore();

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: -280, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }} transition={{ type: "spring", stiffness: 140, damping: 20 }}
            className="glass absolute left-4 top-20 z-20 max-h-[calc(100vh-9rem)] w-60 overflow-y-auto rounded-xl p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <Layers size={14} className="text-cyan" />
              <span className="text-xs font-bold tracking-widest text-slate-200">LAYERS</span>
            </div>
            <Toggle label="Ground Plane" checked={s.showGround} onChange={() => s.toggle("showGround")} />
            <Toggle label="Holo Boxes" checked={s.showBoxes} onChange={() => s.toggle("showBoxes")} />
            <Toggle label="Radar Rings" checked={s.showRadar} onChange={() => s.toggle("showRadar")} />
            <Toggle label="Post-FX Bloom" checked={s.showPostFx} onChange={() => s.toggle("showPostFx")} />
            <Toggle label="Inspector" checked={s.inspectEnabled} onChange={() => s.toggle("inspectEnabled")} />
            <Toggle label="Ruler" hint="M" checked={s.rulerActive} onChange={() => s.toggle("rulerActive")} />

            <div className="mt-3 flex items-center gap-2">
              <CircleDot size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Point Size · {s.pointSize.toFixed(1)}</span>
            </div>
            <input type="range" min={0.5} max={6} step={0.1} value={s.pointSize}
              onChange={(e) => s.setPoint(+e.target.value)} className="mt-1 w-full" />

            <div className="mt-2 flex items-center gap-2">
              <Boxes size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Intensity ≥ {s.intensityMin.toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={0.95} step={0.05} value={s.intensityMin}
              onChange={(e) => s.setIntensity(+e.target.value)} className="mt-1 w-full" />

            <div className="mt-3 flex items-center gap-2">
              <Palette size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">Colormap <kbd className="mono text-slate-500">C</kbd></span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {COLORMAPS.map((m) => (
                <button key={m} onClick={() => s.setColormap(m)}
                  className={`mono rounded-md border px-1 py-1 text-[9px] uppercase transition ${
                    s.colormap === m
                      ? "border-cyan text-cyan shadow-[0_0_8px_rgba(0,245,255,0.4)]"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                  {m}
                </button>
              ))}
            </div>

            {/* ROI cropper */}
            <button onClick={() => setRoiOpen(!roiOpen)}
              className="mt-4 flex w-full items-center gap-2 border-t border-white/5 pt-3 text-left">
              <Crop size={12} className="text-cyan" />
              <span className="text-[11px] text-slate-300">ROI Slicer</span>
              <motion.span animate={{ rotate: roiOpen ? 90 : 0 }} className="ml-auto">
                <ChevronLeft size={12} className="text-slate-500" />
              </motion.span>
            </button>
            <AnimatePresence>
              {roiOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  {([["xMin", "X min", -80, 0], ["xMax", "X max", 0, 80],
                     ["yMin", "Y min", -40, 0], ["yMax", "Y max", 0, 40],
                     ["zMin", "Z min", -3, 0], ["zMax", "Z max", 0, 40]] as const).map(([key, label, min, max]) => (
                    <Range key={key} label={label} value={s.roi[key]} min={min} max={max} step={1}
                      onChange={(v) => s.setRoi({ [key]: v })} />
                  ))}
                  <button onClick={s.resetRoi}
                    className="mono mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 py-1 text-[10px] text-amber-300 hover:bg-amber-400/20">
                    <Scissors size={10} /> reset bounds
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* scenarios + density */}
            <div className="mt-3 border-t border-white/5 pt-3">
              <span className="text-[11px] text-slate-300">Scenario</span>
              <div className="mt-1.5 flex gap-1.5">
                {SCENARIOS.map((sc) => (
                  <button key={sc.id} onClick={() => setSimScenario(sc.id)}
                    className={`mono flex-1 rounded-md border px-1 py-1 text-[9px] uppercase transition ${
                      s.scenario === sc.id
                        ? "border-violet-400 text-violet-300 shadow-[0_0_8px_rgba(112,0,255,0.5)]"
                        : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                    {sc.label}
                  </button>
                ))}
              </div>
              <Range label="Cloud Density" value={25000} min={5000} max={50000} step={5000}
                onChange={(v) => sendCmd({ cmd: "set_points", n: v })} />
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
