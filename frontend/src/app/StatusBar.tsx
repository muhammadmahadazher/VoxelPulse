import { useState } from "react";
import { useStore } from "../store";
import { useProjectStore } from "../stores/projectStore";
import { CrsChooser } from "./CrsChooser";
import { spatialReferenceRegistry } from "../core/spatial/registry";
import { axisLabels, formatAngular, formatLinear, type AngularUnitId, type LinearUnitId } from "../core/spatial/units";
import { UNKNOWN_REFERENCE } from "../core/spatial/reference";

/** Calm, readable status bar: CRS · cursor · selection — data · perf · mode.
 *  §24–25: the CRS item is interactive and coordinates render per CRS kind —
 *  E/N/Z metres for projected, lon/lat degrees for geographic, uncertainty
 *  visible when UNKNOWN. */
export function StatusBar() {
  const probe = useStore((s) => s.inspectPoint);
  const rendered = useStore((s) => s.renderedPoints);
  const fps = useStore((s) => s.fps);
  const mode = useStore((s) => s.mode);
  const crsId = useProjectStore((s) => s.crs);
  const layers = useProjectStore((s) => s.layers);
  const selection = useProjectStore((s) => s.selection);
  const [chooserOpen, setChooserOpen] = useState(false);

  const ref = (() => {
    if (crsId === "VP:LOCAL") return null; // local — displayed as LOCAL
    try { return spatialReferenceRegistry.resolve(crsId); } catch { return UNKNOWN_REFERENCE; }
  })();
  const labels = axisLabels(ref ? (ref.kind === "geographic" ? "geographic" : "projected") : "local");
  const [ax, ay] = labels;

  const coordText = (() => {
    if (!probe) return "move cursor over the cloud";
    if (!ref) return `${ax} ${probe.x.toFixed(2)}  ${ay} ${probe.y.toFixed(2)}  Z ${probe.z.toFixed(2)} m`;
    if (ref.kind === "geographic") {
      return `${ax} ${formatAngular(probe.x)}  ${ay} ${formatAngular(probe.y)}  Z ${formatLinear(probe.z, "metre")}`;
    }
    return `${ax} ${formatLinear(probe.x, "metre", { groupThousands: true })}  ${ay} ${formatLinear(probe.y, "metre", { groupThousands: true })}  Z ${formatLinear(probe.z, "metre")}`;
  })();

  const crsLabel = !ref ? "LOCAL CRS"
    : ref.id === "VP:UNKNOWN" ? "CRS UNKNOWN"
    : `${ref.id}${ref.code && ref.name ? ` · ${shortName(ref.name)}` : ""}`;

  const n = rendered;
  const cell = "px-3 font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-3)] whitespace-nowrap";
  const selectionLabel =
    selection.kind === "layer" ? layers.find((l) => l.id === selection.id)?.name ?? "layer" :
    selection.kind === "track" ? `track ${selection.id}` :
    selection.kind === "point" ? "point" : "";

  return (
    <footer className="vp-chrome flex h-[var(--vp-status-h)] items-center justify-between border-t">
      <div className="flex min-w-0 items-center">
        <button onClick={() => setChooserOpen(true)}
          title="Project spatial reference"
          className={`${cell} vp-focusable rounded px-3 ${ref?.id === "VP:UNKNOWN" ? "text-[var(--vp-warning)]" : "text-[var(--vp-text-2)]"} hover:text-[var(--vp-accent)]`}>
          {crsLabel}
        </button>
        <span className={`${cell} ${probe ? "text-[var(--vp-text-2)]" : ""}`}>{coordText}</span>
        {selectionLabel && (
          <span className={`${cell} text-[var(--vp-accent)]`}>◈ {selectionLabel}</span>
        )}
      </div>
      <div className="flex items-center">
        <span className={cell}>{n.toLocaleString()} pts visible</span>
        <span className={cell}>{fps.toFixed(0)} FPS</span>
        <span className={`${cell} ${mode === "live" ? "text-[var(--vp-success)]" : mode === "sim" ? "text-[var(--vp-warning)]" : ""}`}>
          {mode === "live" ? "● live sensor" : mode === "sim" ? "◐ demo scene" : mode}
        </span>
      </div>
      {chooserOpen && (
        <CrsChooser mode="project" current={crsId} onClose={() => setChooserOpen(false)} />
      )}
    </footer>
  );
}

function shortName(name: string): string {
  return name.replace(/^WGS 84 \/ /, "");
}

export type { LinearUnitId, AngularUnitId };
