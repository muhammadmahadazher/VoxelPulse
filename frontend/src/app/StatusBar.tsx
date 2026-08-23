import { useStore } from "../store";
import { useProjectStore } from "../stores/projectStore";

/** Calm, readable status bar: CRS · cursor · selection — data · perf · mode. */
export function StatusBar() {
  const probe = useStore((s) => s.inspectPoint);
  const frame = useStore((s) => s.lastFrame);
  const fps = useStore((s) => s.fps);
  const mode = useStore((s) => s.mode);
  const layers = useProjectStore((s) => s.layers);
  const selection = useProjectStore((s) => s.selection);

  const n = frame?.n ?? 0;
  const cell = "px-3 font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-3)] whitespace-nowrap";
  const selectionLabel =
    selection.kind === "layer" ? layers.find((l) => l.id === selection.id)?.name ?? "layer" :
    selection.kind === "track" ? `track ${selection.id}` :
    selection.kind === "point" ? "point" : "";

  return (
    <footer className="vp-chrome flex h-[var(--vp-status-h)] items-center justify-between border-t">
      <div className="flex min-w-0 items-center">
        <span className={`${cell} text-[var(--vp-text-2)]`}>LOCAL CRS</span>
        <span className={`${cell} ${probe ? "text-[var(--vp-text-2)]" : ""}`}>
          {probe
            ? `X ${probe.x.toFixed(1)}  Y ${probe.y.toFixed(1)}  Z ${probe.z.toFixed(1)} m`
            : "move cursor over the cloud"}
        </span>
        {selectionLabel && (
          <span className={`${cell} text-[var(--vp-accent)]`}>◈ {selectionLabel}</span>
        )}
      </div>
      <div className="flex items-center">
        <span className={cell}>{n.toLocaleString()} pts</span>
        <span className={cell}>{fps.toFixed(0)} FPS</span>
        <span className={`${cell} ${mode === "live" ? "text-[var(--vp-success)]" : mode === "sim" ? "text-[var(--vp-warning)]" : ""}`}>
          {mode === "live" ? "● live sensor" : mode === "sim" ? "◐ demo scene" : mode}
        </span>
      </div>
    </footer>
  );
}
