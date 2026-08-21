import { useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Box, Radio, Camera, Crosshair, ArrowUpDown } from "lucide-react";
import { useProjectStore, type Layer } from "../stores/projectStore";
import { ContextMenu, type MenuItem } from "../app/ContextMenu";

const TYPE_ICON: Record<string, React.ReactNode> = {
  pointcloud: <Box size={12} />,
  detections: <Radio size={12} />,
  camera: <Camera size={12} />,
  reference: <Crosshair size={12} />,
  group: <ArrowUpDown size={12} />,
};

/** Docked layer tree: visibility, opacity, lock, rename, reorder, remove,
 *  zoom-to, context menu. Source of truth is projectStore. */
export function LayersPanel({ onZoomTo }: { onZoomTo: (layer: Layer) => void }) {
  const layers = useProjectStore((s) => s.layers);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const [ctx, setCtx] = useState<{ x: number; y: number; layer: Layer } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const layerMenu = (l: Layer): MenuItem[] => [
    { id: "zoom", label: "Zoom to Layer", run: () => onZoomTo(l) },
    { id: "rename", label: "Rename…", run: () => setRenaming(l.id) },
    { id: "up", label: "Move Up", disabled: layers[0]?.id === l.id, run: () => useProjectStore.getState().reorderLayer(l.id, -1) },
    { id: "down", label: "Move Down", separatorAfter: true, disabled: layers[layers.length - 1]?.id === l.id, run: () => useProjectStore.getState().reorderLayer(l.id, 1) },
    { id: "remove", label: "Remove Layer", danger: true, run: () => useProjectStore.getState().removeLayer(l.id) },
  ];

  return (
    <div className="flex h-full flex-col" role="tree">
      <div className="px-3 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vp-text-3)]">
        Layers
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        {layers.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-[var(--vp-text-3)]">
            No layers yet.<br />Add a point cloud or start an example.
          </div>
        )}
        {[...layers].reverse().map((l) => {
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
              className={`vp-focusable group mb-0.5 cursor-pointer rounded border px-2 py-1.5 transition-colors
                ${selected
                  ? "border-[var(--vp-accent)] bg-[var(--vp-accent-soft)]"
                  : "border-transparent hover:bg-white/[0.04]"}`}
            >
              <div className="flex items-center gap-2">
                <span className={l.visible ? "text-[var(--vp-accent)]" : "text-[var(--vp-text-3)]"}>
                  {TYPE_ICON[l.type] ?? TYPE_ICON.pointcloud}
                </span>
                {renaming === l.id ? (
                  <input
                    autoFocus
                    defaultValue={l.name}
                    className="w-full rounded bg-black/40 px-1 py-0.5 text-[11px] text-[var(--vp-text-1)] outline-none"
                    onBlur={(e) => { useProjectStore.getState().updateLayer(l.id, { name: e.target.value || l.name }); setRenaming(null); }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className={`flex-1 truncate text-[11px] ${l.visible ? "text-[var(--vp-text-1)]" : "text-[var(--vp-text-3)]"}`}>
                    {l.name}
                  </span>
                )}
                {l.source?.kind === "file" && l.pointCount != null && (
                  <span className="font-[var(--vp-font-mono)] text-[9px] text-[var(--vp-text-3)]">
                    {(l.pointCount / 1000).toFixed(0)}k
                  </span>
                )}
                <button
                  title={l.locked ? "Unlock" : "Lock"}
                  onClick={(e) => { e.stopPropagation(); useProjectStore.getState().updateLayer(l.id, { locked: !l.locked }); }}
                  className={`rounded p-0.5 ${l.locked ? "text-[var(--vp-highlight)]" : "text-[var(--vp-text-3)] opacity-0 group-hover:opacity-100"}`}
                >
                  {l.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                </button>
                <button
                  title={l.visible ? "Hide" : "Show"}
                  onClick={(e) => { e.stopPropagation(); useProjectStore.getState().updateLayer(l.id, { visible: !l.visible }); }}
                  className={`rounded p-0.5 ${l.visible ? "text-[var(--vp-text-2)]" : "text-[var(--vp-text-3)]"}`}
                >
                  {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
              {selected && (
                <div className="mt-1.5 flex items-center gap-2 pl-6">
                  <span className="text-[9px] text-[var(--vp-text-3)]">opacity</span>
                  <input
                    type="range" min={0.1} max={1} step={0.05} value={l.opacity}
                    onChange={(e) => useProjectStore.getState().updateLayer(l.id, { opacity: +e.target.value })}
                    className="h-1 flex-1"
                  />
                  <span className="w-7 font-[var(--vp-font-mono)] text-[9px] text-[var(--vp-text-3)]">{(l.opacity * 100) | 0}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={layerMenu(ctx.layer)} onClose={() => setCtx(null)} />}
    </div>
  );
}
