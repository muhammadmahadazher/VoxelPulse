import { useStore } from "../store";
import { useProjectStore } from "../stores/projectStore";

/** Quiet professional status bar (ArcGIS-style): CRS | cursor | points | FPS | mode. */
export function StatusBar() {
  const probe = useStore((s) => s.inspectPoint);
  const frame = useStore((s) => s.lastFrame);
  const fps = useStore((s) => s.fps);
  const mode = useStore((s) => s.mode);
  const layers = useProjectStore((s) => s.layers);

  const n = frame?.n ?? 0;
  const cell = "px-3 text-[10px] font-[var(--vp-font-mono)] text-[var(--vp-text-3)]";
  return (
    <div className="vp-panel flex h-6 items-center justify-between border-t">
      <div className="flex items-center">
        <span className={cell}>CRS: local (EPSG:—)</span>
        {probe ? (
          <span className={cell}>
            X {probe.x.toFixed(2)} · Y {probe.y.toFixed(2)} · Z {probe.z.toFixed(2)}
          </span>
        ) : (
          <span className={cell}>—</span>
        )}
        <span className={cell}>{n.toLocaleString()} pts visible</span>
      </div>
      <div className="flex items-center">
        <span className={cell}>{layers.length} layer{layers.length === 1 ? "" : "s"}</span>
        <span className={cell}>{fps.toFixed(0)} FPS</span>
        <span className={cell}>{mode === "live" ? "live sensor" : mode === "sim" ? "demo scene" : mode}</span>
      </div>
    </div>
  );
}
