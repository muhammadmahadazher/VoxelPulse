import { useState } from "react";
import { Eye, EyeOff, Lock, Box, Radio, Camera, Crosshair, ChevronRight, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectStore, type Layer, type LayerType } from "../stores/projectStore";
import { ContextMenu, type MenuItem } from "../app/ContextMenu";
import { PanelHeader, IconButton, Tooltip } from "../ui/kit";

const TYPE_ICON: Record<LayerType, React.ReactNode> = {
  pointcloud: <Box size={14} />,
  detections: <Radio size={14} />,
  camera: <Camera size={14} />,
  reference: <Crosshair size={14} />,
  group: <ChevronRight size={14} />,
};

const GROUPS: { title: string; types: LayerType[] }[] = [
  { title: "LiDAR", types: ["pointcloud"] },
  { title: "Perception", types: ["detections", "camera"] },
  { title: "Scene", types: ["reference", "group"] },
];

/** Docked layer tree: grouped sections, 30px rows, hover actions, clear
 *  selection states, inline opacity for the selected layer. */
export function LayersPanel({ onZoomTo, onAddData }: {
  onZoomTo: (layer: Layer) => void;
  onAddData: () => void;
}) {
  const layers = useProjectStore((s) => s.layers);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const [ctx, setCtx] = useState<{ x: number; y: number; layer: Layer } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const layerMenu = (l: Layer): MenuItem[] => [
    { id: "zoom", label: "Zoom to Layer", run: () => onZoomTo(l) },
    { id: "rename", label: "Rename…", run: () => setRenaming(l.id) },
    { id: "up", label: "Move Up", disabled: layers[0]?.id === l.id, run: () => useProjectStore.getState().reorderLayer(l.id, -1) },
    { id: "down", label: "Move Down", separatorAfter: true, disabled: layers[layers.length - 1]?.id === l.id, run: () => useProjectStore.getState().reorderLayer(l.id, 1) },
    { id: "remove", label: "Remove Layer", danger: true, run: () => useProjectStore.getState().removeLayer(l.id) },
  ];

  const groupsWithLayers = GROUPS.map((g) => ({
    ...g,
    items: [...layers].reverse().filter((l) => g.types.includes(l.type)),
  })).filter((g) => g.items.length > 0 || g.title === "LiDAR");

  return (
    <div className="flex h-full flex-col" role="tree">
      <PanelHeader
        title="Layers"
        actions={
          <Tooltip text="Add point cloud">
            <IconButton icon={<Plus size={14} />} onClick={onAddData} />
          </Tooltip>
        }
      />

      <div className="flex-1 overflow-y-auto py-1">
        {layers.length === 0 && (
          <div className="px-4 py-8 text-center text-[12.5px] leading-relaxed text-[var(--vp-text-3)]">
            No layers yet.<br />Add a point cloud or load an example.
          </div>
        )}
        {groupsWithLayers.map((g) => (
          <section key={g.title} className="mb-1">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}
              className="flex min-h-[26px] w-full items-center gap-1.5 px-3 py-0.5 text-left">
              <motion.span animate={{ rotate: collapsed[g.title] ? 0 : 90 }} transition={{ duration: 0.12 }}>
                <ChevronRight size={12} className="text-[var(--vp-text-3)]" />
              </motion.span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--vp-text-3)]">
                {g.title}
              </span>
              <span className="font-[var(--vp-font-mono)] text-[10.5px] text-[var(--vp-text-3)] opacity-60">{g.items.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {!collapsed[g.title] && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                  {g.items.map((l) => {
                    const selected = selection.kind === "layer" && selection.id === l.id;
                    return (
                      <div
                        key={l.id}
                        role="treeitem"
                        aria-selected={selected}
                        tabIndex={0}
                        onClick={() => select({ kind: "layer", id: l.id })}
                        onKeyDown={(e) => e.key === "Enter" && select({ kind: "layer", id: l.id })}
                        onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, layer: l }); }}
                        className={`group relative mx-1.5 flex min-h-[30px] cursor-pointer items-center gap-2 rounded-[var(--vp-r-md)] px-2.5 transition-colors
                          ${selected
                            ? "bg-[var(--vp-selected)]"
                            : "hover:bg-[var(--vp-hover)]"}`}>
                        {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-[var(--vp-accent)]" />}
                        <span className={l.visible ? "text-[var(--vp-text-2)]" : "text-[var(--vp-text-3)]"}>
                          {TYPE_ICON[l.type]}
                        </span>
                        {renaming === l.id ? (
                          <input
                            autoFocus
                            defaultValue={l.name}
                            className="min-w-0 flex-1 rounded bg-black/30 px-1.5 py-0.5 text-[13px] text-[var(--vp-text-1)] outline-none"
                            onBlur={(e) => { useProjectStore.getState().updateLayer(l.id, { name: e.target.value || l.name }); setRenaming(null); }}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                        ) : (
                          <span className={`flex-1 truncate text-[13px] ${l.visible ? (selected ? "text-[var(--vp-text-1)]" : "text-[var(--vp-text-1)]/90") : "text-[var(--vp-text-3)] line-through decoration-1"}`}>
                            {l.name}
                          </span>
                        )}
                        {l.source?.kind === "file" && l.pointCount != null && (
                          <span className="font-[var(--vp-font-mono)] text-[10.5px] text-[var(--vp-text-3)]">
                            {l.pointCount >= 1000 ? `${(l.pointCount / 1000).toFixed(0)}k` : l.pointCount}
                          </span>
                        )}
                        {l.locked && <Lock size={12} className="text-[var(--vp-warning)]/70" />}
                        <button
                          title={l.visible ? "Hide layer" : "Show layer"}
                          onClick={(e) => { e.stopPropagation(); useProjectStore.getState().updateLayer(l.id, { visible: !l.visible }); }}
                          className={`flex h-[22px] w-[22px] items-center justify-center rounded transition-all
                            ${l.visible ? "text-[var(--vp-text-3)] opacity-0 group-hover:opacity-100" : "text-[var(--vp-warning)] opacity-100"}`}>
                            {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        ))}
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={layerMenu(ctx.layer)} onClose={() => setCtx(null)} />}
    </div>
  );
}
