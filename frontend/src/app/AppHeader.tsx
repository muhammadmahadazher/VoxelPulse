import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Box, RotateCcw, Video, PersonStanding, Layers, PanelRight, PanelBottom, Sparkles, Sun, Moon, Maximize2 } from "lucide-react";
import { useUiStore } from "../stores/uiStore";
import { useProjectStore } from "../stores/projectStore";
import { useStore, type ViewLayout } from "../store";
import { Chip, ToolButton, Segmented, Tooltip } from "../ui/kit";
import type { MenuDef } from "./ContextMenu";

export type { MenuDef } from "./ContextMenu";

/** Two-row application header: navigation + contextual spatial toolbar. */
export function AppHeader({
  menus, onAddData, onMaximize,
}: {
  menus: MenuDef[];
  onAddData: () => void;
  onMaximize: () => void;
}) {
  const menuOpen = useUiStore((s) => s.menuOpen);
  const setMenuOpen = useUiStore((s) => s.setMenuOpen);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const colorMode = useUiStore((s) => s.colorMode);
  const toggleColorMode = useUiStore((s) => s.toggleColorMode);
  const panels = useUiStore((s) => s.panels);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const barRef = useRef<HTMLDivElement>(null);
  const dirty = useProjectStore((s) => s.dirty);
  const meta = useProjectStore((s) => s.meta);
  const mode = useStore((s) => s.mode);
  const viewLayout = useStore((s) => s.viewLayout);
  const setViewLayout = useStore((s) => s.setViewLayout);
  const togglePalette = useStore((s) => s.toggle);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenuOpen(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [setMenuOpen]);

  const live = mode === "live";
  const demo = mode === "sim";

  return (
    <header ref={barRef} className="vp-chrome relative z-40 shrink-0 border-b">
      {/* Row 1 — application navigation */}
      <div className="flex h-[var(--vp-header-1)] items-center gap-0.5 px-2.5" role="menubar">
        <div className="mr-3 flex items-center gap-2">
          <BrandMark />
          <span className="text-[13px] font-semibold tracking-wide text-[var(--vp-text-1)]">VoxelPulse</span>
        </div>
        {menus.map((m) => (
          <div key={m.id} className="relative">
            <button
              role="menuitem"
              onClick={() => setMenuOpen(menuOpen === m.id ? null : m.id)}
              onMouseEnter={() => menuOpen && setMenuOpen(m.id)}
              className={`vp-focusable rounded-[var(--vp-r-sm)] px-2.5 py-1 text-[13px] transition-colors
                ${menuOpen === m.id
                  ? "bg-[var(--vp-hover)] text-[var(--vp-text-1)]"
                  : "text-[var(--vp-text-2)] hover:text-[var(--vp-text-1)]"}`}>
              {m.label}
            </button>
            <AnimatePresence>
              {menuOpen === m.id && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  role="menu"
                  className="vp-floating absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-[var(--vp-r-lg)] border py-1.5"
                >
                  {m.items.map((it) => (
                    <div key={it.id}>
                      <button
                        role="menuitem"
                        disabled={it.disabled}
                        onClick={() => { setMenuOpen(null); it.run(); }}
                        className={`flex min-h-[var(--vp-menu-row)] w-full items-center justify-between px-3 text-left text-[13px] transition-colors
                          ${it.disabled
                            ? "cursor-default text-[var(--vp-text-3)] opacity-60"
                            : it.danger
                              ? "text-[var(--vp-error)] hover:bg-[var(--vp-hover)]"
                              : "text-[var(--vp-text-1)] hover:bg-[var(--vp-hover)]"}`}>
                        <span>{it.label}</span>
                        {it.shortcut && <span className="ml-10 font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-3)]">{it.shortcut}</span>}
                      </button>
                      {it.separatorAfter && <div className="my-1.5 border-t" style={{ borderColor: "var(--vp-divider)" }} />}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
            {meta.name}{dirty ? " •" : ""}
          </span>
          {live && <Chip tone="success">LIVE</Chip>}
          {demo && <Chip tone="warning">DEMO DATA</Chip>}
          <Tooltip text="Search commands" shortcut="⌘K">
            <button onClick={() => togglePalette("paletteOpen")}
              className="vp-focusable flex h-[var(--vp-ctl-sm)] items-center gap-2 rounded-[var(--vp-r-md)] border px-2.5 text-[12px] text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"
              style={{ background: "var(--vp-hover)" }}>
              <Search size={13} />
              <span className="hidden font-[var(--vp-font-mono)] xl:inline">⌘K</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Row 2 — contextual spatial toolbar */}
      <div className="flex h-[var(--vp-header-2)] items-center gap-1 border-t px-2.5" style={{ borderColor: "var(--vp-divider)" }}>
        <Tooltip text="Orbit reset" shortcut="R"><ToolButton icon={<RotateCcw size={16} />} onClick={() => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "orbit" }))} /></Tooltip>
        <Tooltip text="Top-down view" shortcut="T"><ToolButton icon={<Video size={16} />} onClick={() => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "top" }))} /></Tooltip>
        <Tooltip text="Chase camera" shortcut="F"><ToolButton icon={<PersonStanding size={16} />} onClick={() => window.dispatchEvent(new CustomEvent("vp-camera", { detail: "chase" }))} /></Tooltip>

        <div className="mx-2 h-5 w-px" style={{ background: "var(--vp-divider)" }} />

        <Segmented<ViewLayout>
          value={viewLayout}
          onChange={setViewLayout}
          options={[
            { id: "single", label: "3D", icon: <Box size={13} /> },
            { id: "split", label: "BEV", icon: <Layers size={13} /> },
            { id: "fusion", label: "Fusion", icon: <Search size={13} /> },
          ]}
        />

        <div className="mx-2 h-5 w-px" style={{ background: "var(--vp-divider)" }} />

        <ToolButton icon={<Plus size={16} />} label="Add Data" onClick={onAddData}
          title="Add point cloud (.las .ply .pcd .xyz)" />

        <div className="ml-auto flex items-center gap-1">
          <Tooltip text="Layers panel" shortcut="⌘B">
            <ToolButton icon={<Layers size={16} />} active={panels.left} onClick={() => togglePanel("left")} />
          </Tooltip>
          <Tooltip text="Inspector">
            <ToolButton icon={<PanelRight size={16} />} active={panels.right} onClick={() => togglePanel("right")} />
          </Tooltip>
          <Tooltip text="Timeline / console" shortcut="⌘J">
            <ToolButton icon={<PanelBottom size={16} />} active={panels.bottom} onClick={() => togglePanel("bottom")} />
          </Tooltip>
          <div className="mx-1 h-5 w-px" style={{ background: "var(--vp-divider)" }} />
          <Tooltip text="Maximize viewport">
            <ToolButton icon={<Maximize2 size={16} />} onClick={onMaximize} />
          </Tooltip>
          <Tooltip text={colorMode === "dark" ? "Light theme" : "Dark theme"}>
            <ToolButton icon={colorMode === "light" ? <Moon size={16} /> : <Sun size={16} />} onClick={toggleColorMode} />
          </Tooltip>
          <Tooltip text="Presentation mode (cinematic FX)">
            <ToolButton icon={<Sparkles size={16} />} onClick={toggleTheme} active={theme === "presentation"} />
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

/** Geometric V formed from spatial points — restrained brand motif. */
export function BrandMark({ size = 18 }: { size?: number }) {
  const pts = [
    [2, 2], [5, 2], [8, 2], [11, 2], [14, 2],
    [3.5, 6], [12.5, 6],
    [5, 10], [11, 10],
    [6.5, 14], [9.5, 14],
    [8, 16.5],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 16 19" aria-hidden>
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={0.9}
          fill={i < 5 ? "var(--vp-accent)" : "var(--vp-text-3)"}
          opacity={i < 5 ? 0.95 : 0.55} />
      ))}
    </svg>
  );
}
