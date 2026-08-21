import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Command, CornerDownLeft, Terminal, Layers as LayersIcon, SlidersHorizontal } from "lucide-react";
import { useStore, COLORMAPS, type Colormap, type ScenarioName, type ViewLayout } from "../store";
import { useProjectStore } from "../stores/projectStore";
import { fuzzyRank } from "../utils/fuzzy";
import { exportScreenshot, exportPly, exportPcd } from "../utils/exporters";
import { setSimScenario } from "../ws";

interface Cmd {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  run: () => void;
}

/** Global ⌘K command center — fuzzy across commands and layers. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const toggle = useStore((s) => s.toggle);
  const layers = useProjectStore((s) => s.layers);
  const selectLayer = useProjectStore((s) => s.select);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const cmap = (c: Colormap): Cmd => ({
      id: `cm-${c}`, label: `Colormap: ${c}`, group: "Render", icon: <SlidersHorizontal size={11} />,
      run: () => useStore.getState().setColormap(c),
    });
    const layout = (v: ViewLayout, label: string): Cmd => ({
      id: `lay-${v}`, label: `Layout: ${label}`, group: "View",
      run: () => useStore.getState().setViewLayout(v),
    });
    const scen = (n: ScenarioName, label: string): Cmd => ({
      id: `sc-${n}`, label: `Demo Scene: ${label}`, group: "Data",
      run: () => setSimScenario(n),
    });
    return [
      { id: "p-project", label: "Project: Save As… (.vxp)", group: "Project", run: () => document.dispatchEvent(new CustomEvent("vp-save-as")) },
      ...layers.map((l): Cmd => ({
        id: `layer-${l.id}`, label: `Layer: ${l.name}`, group: "Layers", icon: <LayersIcon size={11} />,
        run: () => selectLayer({ kind: "layer", id: l.id }),
      })),
      ...COLORMAPS.map(cmap),
      layout("single", "3D Orbit"),
      layout("split", "Split 3D + BEV"),
      layout("fusion", "2D/3D Fusion View"),
      scen("urban", "Urban"),
      scen("warehouse", "Warehouse"),
      scen("drone", "Drone"),
      { id: "t-ruler", label: "Tool: Laser Ruler", group: "Tools", run: () => useStore.getState().toggle("rulerActive") },
      { id: "t-crop", label: "Tool: ROI Crop Gizmo", group: "Tools", run: () => useStore.getState().toggle("showCropGizmo") },
      { id: "t-edl", label: "Render: Toggle Eye-Dome Lighting", group: "Render", run: () => useStore.getState().toggle("showEdl") },
      { id: "cam-orbit", label: "Camera: Orbit Reset", group: "View", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "orbit" })) },
      { id: "cam-top", label: "Camera: Top-Down", group: "View", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "top" })) },
      { id: "cam-chase", label: "Camera: Chase", group: "View", run: () => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "chase" })) },
      { id: "x-png", label: "Export: 4K PNG Snapshot", group: "Export", run: exportScreenshot },
      { id: "x-ply", label: "Export: Selection → .PLY", group: "Export", run: exportPly },
      { id: "x-pcd", label: "Export: Selection → .PCD", group: "Export", run: exportPcd },
    ];
  }, [layers, selectLayer]);

  const filtered = useMemo(
    () => fuzzyRank(query, commands, (c) => `${c.label} ${c.group}`),
    [commands, query]
  );

  useEffect(() => { if (open) { setQuery(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => setSel(0), [query]);

  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 flex items-start justify-center bg-black/40 pt-24 backdrop-blur-sm"
        onClick={() => toggle("paletteOpen")}
      >
        <motion.div
          initial={{ y: -10, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="vp-overlay w-[480px] overflow-hidden rounded-xl border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-[var(--vp-divider)] px-4 py-3">
            <Command size={14} className="text-[var(--vp-accent)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                if (e.key === "Enter" && filtered[sel]) { filtered[sel].item.run(); toggle("paletteOpen"); }
                if (e.key === "Escape") toggle("paletteOpen");
              }}
              placeholder="Search commands, layers, colormaps…"
              className="w-full bg-transparent text-[13px] text-[var(--vp-text-1)] placeholder-[var(--vp-text-3)] outline-none"
              aria-label="command palette"
            />
            <kbd className="rounded border border-[var(--vp-border)] px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[10px] text-[var(--vp-text-3)]">ESC</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-[var(--vp-text-3)]">no matches</div>
            )}
            {filtered.map((f, i) => (
              <button
                key={f.item.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => { f.item.run(); toggle("paletteOpen"); }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] transition-colors
                  ${i === sel ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]" : "text-[var(--vp-text-1)] hover:bg-white/[0.04]"}`}
              >
                {f.item.icon ?? <Terminal size={11} className="text-[var(--vp-text-3)]" />}
                <span className="flex-1">{f.item.label}</span>
                <span className="text-[9px] uppercase tracking-wider text-[var(--vp-text-3)]">{f.item.group}</span>
                {i === sel && <CornerDownLeft size={11} className="text-[var(--vp-accent)]" />}
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
