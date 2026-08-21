import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Command, CornerDownLeft } from "lucide-react";
import { useStore, COLORMAPS, type Colormap, type ScenarioName, type ViewLayout } from "../store";
import { setSimScenario } from "../ws";
import { exportScreenshot, exportPly, exportPcd } from "../utils/exporters";

interface Cmd {
  id: string;
  label: string;
  group: string;
  run: () => void;
}

/** Global ⌘K / Ctrl+K command center. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const toggle = useStore((s) => s.toggle);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const s = useStore.getState();
    const cmap = (c: Colormap): Cmd => ({
      id: `cm-${c}`, label: `Colormap: ${c}`, group: "Palette",
      run: () => useStore.getState().setColormap(c),
    });
    const scenario = (n: ScenarioName, label: string): Cmd => ({
      id: `sc-${n}`, label: `Scenario: ${label}`, group: "Scenarios", run: () => setSimScenario(n),
    });
    const layout = (v: ViewLayout, label: string): Cmd => ({
      id: `lay-${v}`, label: `Layout: ${label}`, group: "Workspace", run: () => useStore.getState().setViewLayout(v),
    });
    return [
      ...COLORMAPS.map(cmap),
      scenario("urban", "Urban Driving"),
      scenario("warehouse", "Warehouse AGV"),
      scenario("drone", "Drone Flight"),
      layout("single", "3D Orbit"),
      layout("split", "Split 3D + BEV"),
      layout("fusion", "2D/3D Fusion View"),
      { id: "lay-ground", label: "Toggle: Ground Plane", group: "Layers", run: () => useStore.getState().toggle("showGround") },
      { id: "lay-boxes", label: "Toggle: Perception Boxes", group: "Layers", run: () => useStore.getState().toggle("showBoxes") },
      { id: "lay-radar", label: "Toggle: Ego Frame / Radar", group: "Layers", run: () => useStore.getState().toggle("showRadar") },
      { id: "lay-edl", label: "Toggle: Eye-Dome Lighting", group: "Layers", run: () => useStore.getState().toggle("showEdl") },
      { id: "lay-fx", label: "Toggle: Post-Processing FX", group: "Layers", run: () => useStore.getState().toggle("showPostFx") },
      { id: "lay-density", label: "Toggle: Density Heatmap", group: "Layers", run: () => useStore.getState().toggle("showDensity") },
      { id: "tool-ruler", label: "Measure: 3D Laser Ruler (M)", group: "Tools", run: () => useStore.getState().toggle("rulerActive") },
      { id: "tool-crop", label: "ROI Crop Gizmo (X)", group: "Tools", run: () => useStore.getState().toggle("showCropGizmo") },
      { id: "tool-inspect", label: "Toggle: Point Inspector", group: "Tools", run: () => useStore.getState().toggle("inspectEnabled") },
      { id: "tool-roi", label: "Reset ROI Crop Bounds", group: "Tools", run: () => useStore.getState().resetRoi() },
      { id: "cam-orbit", label: "Camera: Orbit Reset (R)", group: "Camera", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "orbit" })) },
      { id: "cam-top", label: "Camera: Top-Down (T)", group: "Camera", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "top" })) },
      { id: "cam-chase", label: "Camera: Chase FPV (F)", group: "Camera", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "chase" })) },
      { id: "shot", label: "Snapshot: 4K PNG (S)", group: "Export", run: exportScreenshot },
      { id: "ply", label: "Export: ROI → .PLY (E)", group: "Export", run: exportPly },
      { id: "pcd", label: "Export: ROI → .PCD", group: "Export", run: exportPcd },
      { id: "pause", label: `Stream: ${s.paused ? "Resume" : "Pause"} (Space)`, group: "Stream", run: () => useStore.getState().toggle("paused") },
    ];
  }, []);

  const filtered = useMemo(
    () => commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [commands, query]
  );

  useEffect(() => { if (open) { setQuery(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => setSel(0), [query]);

  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 flex items-start justify-center bg-black/50 pt-28 backdrop-blur-sm"
        onClick={() => toggle("paletteOpen")}
      >
        <motion.div
          initial={{ y: -14, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -10, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="glass w-[460px] overflow-hidden rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <Command size={14} className="text-cyan" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                if (e.key === "Enter" && filtered[sel]) { filtered[sel].run(); toggle("paletteOpen"); }
                if (e.key === "Escape") toggle("paletteOpen");
              }}
              placeholder="Type a command… (colormaps, scenarios, cameras, export)"
              className="mono w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
            />
            <kbd className="mono rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500">ESC</kbd>
          </div>
          <div className="max-h-72 overflow-y-scroll p-1.5">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-500">no matching commands</div>
            )}
            {filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => { c.run(); toggle("paletteOpen"); }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ${
                  i === sel ? "bg-cyan/15 text-cyan" : "text-slate-300 hover:bg-white/5"}`}
              >
                <span>{c.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">{c.group}</span>
                  {i === sel && <CornerDownLeft size={11} />}
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
