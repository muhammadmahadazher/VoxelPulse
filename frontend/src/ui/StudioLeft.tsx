import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, ChevronRight, Palette, CircleDot, Eye, EyeOff, Crop, Boxes, Ruler,
  Radar, Grid3x3, Camera, Crosshair, Sparkles, Scissors, Car, Activity,
} from "lucide-react";
import { useStore, COLORMAPS } from "../store";
import { sendCmd, setSimScenario } from "../ws";
import type { ScenarioName } from "../store";

function TreeRow({ label, icon, checked, onChange, indent = 0 }: {
  label: string; icon: React.ReactNode; checked: boolean; onChange: () => void; indent?: number;
}) {
  return (
    <button
      onClick={onChange}
      className="group flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-2 text-left hover:bg-white/5"
      style={{ paddingLeft: 8 + indent * 14 }}
    >
      <span className={checked ? "text-sky-400" : "text-slate-600"}>{icon}</span>
      <span className={`flex-1 truncate text-[11px] ${checked ? "text-slate-200" : "text-slate-500"}`}>
        {label}
      </span>
      <span className={checked ? "text-sky-400" : "text-slate-700 group-hover:text-slate-400"}>
        {checked ? <Eye size={12} /> : <EyeOff size={12} />}
      </span>
    </button>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 py-1.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 px-3 py-1">
        <motion.span animate={{ rotate: open ? 90 : 0 }}>
          <ChevronRight size={11} className="text-slate-500" />
        </motion.span>
        <span className="mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-1.5 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SCENARIOS: { id: ScenarioName; label: string }[] = [
  { id: "urban", label: "Urban" },
  { id: "warehouse", label: "Warehouse" },
  { id: "drone", label: "Drone" },
];

/** Left dock: hierarchical blueprint tree + render controls. */
export function StudioLeft() {
  const s = useStore();
  const [open, setOpen] = useState(true);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: -300, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 22 }}
            className="glass absolute bottom-32 left-3 top-16 z-20 flex w-64 flex-col overflow-hidden rounded-xl border-white/10"
          >
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
              <Layers size={13} className="text-sky-400" />
              <span className="mono text-[10px] font-bold tracking-[0.2em] text-slate-300">BLUEPRINT</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Section title="Scene Entities">
                <TreeRow label="Ego Sensor (0,0,0)" icon={<Radar size={12} />} checked={s.showRadar} onChange={() => s.toggle("showRadar")} />
                <TreeRow label="Ground Plane" icon={<Grid3x3 size={12} />} checked={s.showGround} onChange={() => s.toggle("showGround")} indent={1} />
                <TreeRow label="Range Rings + Sweep" icon={<Radar size={12} />} checked={s.showRadar} onChange={() => s.toggle("showRadar")} indent={1} />
                <TreeRow label="Point Cloud Stream" icon={<Boxes size={12} />} checked onChange={() => s.setPoint(s.pointSize)} />
                <TreeRow label="Detected Objects" icon={<Car size={12} />} checked={s.showBoxes} onChange={() => s.toggle("showBoxes")} indent={1} />
                <TreeRow label="Camera 01" icon={<Camera size={12} />} checked={s.pipMode !== "bev" || true} onChange={() => useStore.getState().toggle("pipLarge")} indent={1} />
                <TreeRow label="Calibration Axes XYZ" icon={<Crosshair size={12} />} checked={s.showRadar} onChange={() => s.toggle("showRadar")} indent={1} />
              </Section>

              <Section title="Shading">
                <TreeRow label="Eye-Dome Lighting (EDL)" icon={<Sparkles size={12} />} checked={s.showEdl} onChange={() => s.toggle("showEdl")} />
                <TreeRow label="Bloom / FX Stack" icon={<Sparkles size={12} />} checked={s.showPostFx} onChange={() => s.toggle("showPostFx")} />
                <TreeRow label="Ruler Tool (M)" icon={<Ruler size={12} />} checked={s.rulerActive} onChange={() => s.toggle("rulerActive")} />
                <TreeRow label="Point Inspector" icon={<Crosshair size={12} />} checked={s.inspectEnabled} onChange={() => s.toggle("inspectEnabled")} />
                <TreeRow label="ROI Crop Gizmo (X)" icon={<Crop size={12} />} checked={s.showCropGizmo} onChange={() => s.toggle("showCropGizmo")} />
                <TreeRow label="Density Heatmap" icon={<Activity size={12} />} checked={s.showDensity} onChange={() => s.toggle("showDensity")} />
              </Section>

              <Section title="Colormap" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-1 px-1.5">
                  {COLORMAPS.map((m) => (
                    <button key={m} onClick={() => s.setColormap(m)}
                      className={`mono rounded border px-1 py-1 text-[9px] uppercase transition ${
                        s.colormap === m
                          ? "border-sky-400 bg-sky-400/10 text-sky-300"
                          : "border-white/10 text-slate-400 hover:border-slate-500"}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 px-2.5">
                  <CircleDot size={11} className="text-sky-400" />
                  <span className="text-[10px] text-slate-400">Size {s.pointSize.toFixed(1)}</span>
                </div>
                <input type="range" min={0.5} max={6} step={0.1} value={s.pointSize}
                  onChange={(e) => s.setPoint(+e.target.value)} className="mx-2.5 mt-1 w-[calc(100%-1.25rem)]" />
                <div className="mt-1.5 flex items-center gap-2 px-2.5">
                  <Palette size={11} className="text-sky-400" />
                  <span className="text-[10px] text-slate-400">Intensity ≥ {s.intensityMin.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={0.95} step={0.05} value={s.intensityMin}
                  onChange={(e) => s.setIntensity(+e.target.value)} className="mx-2.5 mt-1 w-[calc(100%-1.25rem)]" />
              </Section>

              <Section title="Scenario Engine" defaultOpen={false}>
                <div className="flex gap-1 px-1.5">
                  {SCENARIOS.map((sc) => (
                    <button key={sc.id} onClick={() => setSimScenario(sc.id)}
                      className={`mono flex-1 rounded border px-1 py-1 text-[9px] uppercase transition ${
                        s.scenario === sc.id
                          ? "border-amber-500 bg-amber-500/10 text-amber-400"
                          : "border-white/10 text-slate-400 hover:border-slate-500"}`}>
                      {sc.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 px-2.5">
                  <span className="text-[10px] text-slate-400">Cloud Density</span>
                  <input type="range" min={5000} max={50000} step={5000} defaultValue={25000}
                    onChange={(e) => sendCmd({ cmd: "set_points", n: +e.target.value })}
                    className="mt-1 w-full" />
                </div>
                <button onClick={s.resetRoi}
                  className="mono mx-1.5 mt-2 flex w-[calc(100%-0.75rem)] items-center justify-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 py-1 text-[9px] text-amber-400 hover:bg-amber-500/20">
                  <Scissors size={10} /> RESET ROI BOUNDS
                </button>
              </Section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(!open)}
        className="glass absolute top-16 z-20 flex h-10 w-6 items-center justify-center rounded-r-xl border-white/10"
        style={{ left: open ? 244 : 8, transition: "left 0.3s" }}>
        <motion.span animate={{ rotate: open ? 0 : 180 }}>
          <ChevronRight size={14} className="text-sky-400" />
        </motion.span>
      </button>
    </>
  );
}
