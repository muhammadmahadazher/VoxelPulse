import { useState } from "react";
import { Radio, ChevronRight, MousePointerClick } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectStore } from "../stores/projectStore";
import { useStore, OBJECT_VELOCITIES, COLORMAPS, type Colormap } from "../store";
import { datasetManager } from "../core/data/datasetManager";
import { rasterRegistry } from "../core/raster/registry";
import { PiP } from "../ui/PiP";
import { PanelHeader, PropertyRow, Slider, Stepper, Switch, EmptyState, Chip } from "../ui/kit";

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b py-1" style={{ borderColor: "var(--vp-divider)" }}>
      <button onClick={() => setOpen(!open)} className="flex min-h-[28px] w-full items-center gap-1.5 px-3 text-left">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.12 }}>
          <ChevronRight size={12} className="text-[var(--vp-text-3)]" />
        </motion.span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--vp-text-3)]">{title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
            <div className="px-3 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Contextual inspector — grouped, editable property sections.
 *  Displays only sections relevant to the current selection. */
export function InspectorPanel() {
  const selection = useProjectStore((s) => s.selection);
  const layers = useProjectStore((s) => s.layers);
  const updateLayer = useProjectStore((s) => s.updateLayer);
  const probe = useStore((s) => s.inspectPoint);
  const frame = useStore((s) => s.lastFrame);
  const t = useStore();

  const layer = selection.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;
  const dataset = layer?.datasetId ? datasetManager.descriptor(layer.datasetId) : undefined;
  const sourceLabel = (() => {
    const src = dataset?.source as { kind?: string; name?: string; url?: string } | undefined;
    if (!src) return layer?.source?.name ?? "";
    return src.name ?? src.url ?? src.kind ?? "";
  })();
  const datasetFields = (dataset?.metadata.fields ?? [])
    .map((f) => (f.semantic && f.semantic !== "custom" ? f.semantic : f.name));
  const crsInfo = dataset?.metadata.spatialReference;
  const track = selection.kind === "track" ? frame?.objects.find((o) => o.id === selection.id) : undefined;
  const vel = selection.kind === "track" ? OBJECT_VELOCITIES[selection.id] : undefined;
  // raster style mutations live on the runtime (engine-owned) — a tick keeps
  // the Inspector's mode select in sync after setStyle
  const [styleTick, setStyleTick] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Inspector" />

      <div className="flex-1 overflow-y-auto">
        {selection.kind === "none" && !probe && (
          <EmptyState
            icon={<MousePointerClick size={16} />}
            title="No selection"
            hint="Select a layer, detection or point to inspect it."
          />
        )}

        {layer && (
          <>
            <div className="px-3 pb-1 pt-2.5">
              <div className="text-[14px] font-semibold text-[var(--vp-text-1)]">{layer.name}</div>
              <div className="mt-1 flex items-center gap-2">
                <Chip tone="accent">{layer.type}</Chip>
                {layer.source && <span className="text-[12px] text-[var(--vp-text-3)]">{layer.source.name}</span>}
              </div>
            </div>

            {layer.type === "pointcloud" && (
              <Section title="Display">
                <PropertyRow label="Colormap">
                  <select
                    value={t.colormap}
                    onChange={(e) => t.setColormap(e.target.value as Colormap)}
                    className="vp-raised h-[24px] rounded-[var(--vp-r-sm)] border px-1.5 text-[12px] text-[var(--vp-text-1)] outline-none">
                    {COLORMAPS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </PropertyRow>
                <PropertyRow label="Point size">
                  <Stepper value={t.pointSize} step={0.2} min={0.5} max={6} onChange={t.setPoint}
                    format={(v) => v.toFixed(1)} />
                </PropertyRow>
                <Slider label="Opacity" value={layer.opacity} min={0.1} max={1} step={0.05}
                  onChange={(v) => updateLayer(layer.id, { opacity: v })}
                  format={(v) => `${(v * 100) | 0}%`} />
                <Slider label="Intensity" value={t.intensityMin} min={0} max={0.95} step={0.05}
                  onChange={t.setIntensity} format={(v) => v.toFixed(2)} />
              </Section>
            )}

            {layer.type === "pointcloud" && (
              <Section title="Range">
                <PropertyRow label="Height min">
                  <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                    {t.heightRange.min.toFixed(2)} m
                  </span>
                </PropertyRow>
                <PropertyRow label="Height max">
                  <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                    {t.heightRange.max.toFixed(2)} m
                  </span>
                </PropertyRow>
              </Section>
            )}

            {layer.type === "raster" && (() => {
              // Raster facts come from the dataset's formatSpecific (§5:
              // descriptors only — pixels live in the runtime).
              const r = (dataset?.metadata.formatSpecific?.raster ?? {}) as {
                width?: number; height?: number; bandCount?: number;
                sampleType?: string; compression?: string;
                cloudOptimized?: boolean; tileSize?: { width: number; height: number };
                overviews?: Array<{ factor: number }>;
                bands?: Array<{ nodata?: number }>;
                crs?: string;
              };
              const nodata = r.bands?.find((b) => b.nodata !== undefined)?.nodata;
              return (
                <>
                  <Section title="Raster">
                    <PropertyRow label="Dimensions">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                        {r.width ?? "?"} × {r.height ?? "?"} px
                      </span>
                    </PropertyRow>
                    <PropertyRow label="Bands">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{r.bandCount ?? "?"}</span>
                    </PropertyRow>
                    <PropertyRow label="Sample type">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{r.sampleType ?? "?"}</span>
                    </PropertyRow>
                    <PropertyRow label="Nodata">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                        {nodata !== undefined ? String(nodata) : "—"}
                      </span>
                    </PropertyRow>
                    <PropertyRow label="Compression">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{r.compression ?? "?"}</span>
                    </PropertyRow>
                    <PropertyRow label="Layout">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                        {r.cloudOptimized ? "COG (verified)" : (r.tileSize ? "tiled TIFF" : "stripped TIFF")}
                      </span>
                    </PropertyRow>
                    {r.tileSize && (
                      <PropertyRow label="Tile size">
                        <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                          {r.tileSize.width} × {r.tileSize.height}
                        </span>
                      </PropertyRow>
                    )}
                    <PropertyRow label="Overviews">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                        {r.overviews?.length ?? 0}
                      </span>
                    </PropertyRow>
                    <PropertyRow label="CRS">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-accent)]">{r.crs ?? "—"}</span>
                    </PropertyRow>
                    <PropertyRow label="Mode">
                      {(() => {
                        const rt = layer.datasetId ? rasterRegistry.get(layer.datasetId) : undefined;
                        if (!rt) return <span className="text-[12px] text-[var(--vp-text-3)]">—</span>;
                        return (
                          <select
                            value={rt.style.mode}
                            onChange={(e) => {
                              rt.setStyle({ mode: e.target.value as typeof rt.style.mode });
                              setStyleTick((n) => n + 1);
                            }}
                            className="vp-raised h-[24px] rounded-[var(--vp-r-sm)] border px-1.5 text-[12px] text-[var(--vp-text-1)] outline-none">
                            <option value="auto">auto</option>
                            <option value="rgb">rgb</option>
                            <option value="grayscale">grayscale</option>
                            <option value="pseudocolor">pseudocolor</option>
                          </select>
                        );
                      })()}
                    </PropertyRow>
                    <StyleStatsRow key={styleTick} datasetId={layer.datasetId} />
                    <Slider label="Opacity" value={layer.opacity} min={0.1} max={1} step={0.05}
                      onChange={(v) => updateLayer(layer.id, { opacity: v })}
                      format={(v) => `${(v * 100) | 0}%`} />
                  </Section>
                </>
              );
            })()}

            {layer.type !== "raster" && (
              <Section title="Rendering">
                <Switch label="Eye-Dome Lighting" checked={t.showEdl} onChange={() => t.toggle("showEdl")} />
                {t.showEdl && (
                  <Slider label="Strength" value={t.edlStrength} min={0.4} max={2.4} step={0.1}
                    onChange={t.setEdlStrength} format={(v) => v.toFixed(1)} />
                )}
                <Switch label="Bloom / FX stack" checked={t.showPostFx} onChange={() => t.toggle("showPostFx")} />
                <Switch label="Ground grid" checked={t.showGround} onChange={() => t.toggle("showGround")} />
              </Section>
            )}

            <Section title="Data">
              {/* §53: dataset-owned facts read from the Dataset model — no
                  duplicate metadata state. Synthetic layers fall back to
                  their inline summary. */}
              {layer.datasetId && !dataset && (
                <>
                  <PropertyRow label="Source">
                    <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-warning)]">missing (not connected)</span>
                  </PropertyRow>
                  <div className="pt-1.5">
                    <button
                      onClick={() => document.dispatchEvent(new CustomEvent("vp-relink", { detail: layer.datasetId }))}
                      className="vp-focusable w-full rounded-[var(--vp-r-md)] border px-2.5 py-1.5 text-[12px] font-medium text-[var(--vp-accent)] hover:bg-[var(--vp-accent-soft)]"
                      style={{ borderColor: "var(--vp-accent)" }}>
                      Locate File…
                    </button>
                    <div className="pt-1 text-[11px] text-[var(--vp-text-3)]">
                      This project references a local file that is not connected in this session.
                    </div>
                  </div>
                </>
              )}
              {layer.datasetId && dataset && (
                <>
                  {crsInfo ? (
                    <PropertyRow label="Spatial Reference">
                      <span className="max-w-[150px] truncate text-right font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]"
                        title={crsInfo.detail ?? crsInfo.reference.name}>
                        {crsInfo.reference.id === "VP:UNKNOWN" ? "Unknown" : crsInfo.reference.name ?? crsInfo.reference.id}
                      </span>
                    </PropertyRow>
                  ) : null}
                  {crsInfo && crsInfo.reference.id !== "VP:UNKNOWN" && (
                    <PropertyRow label="CRS">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-accent)]">{crsInfo.reference.id}</span>
                    </PropertyRow>
                  )}
                  {crsInfo && (
                    <PropertyRow label="Provenance">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-3)]">{crsInfo.source}</span>
                    </PropertyRow>
                  )}
                  {crsInfo && crsInfo.reference.id !== "VP:UNKNOWN" && (
                    <PropertyRow label="Units">
                      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{crsInfo.reference.horizontalUnit.name}</span>
                    </PropertyRow>
                  )}
                  <PropertyRow label="Format">
                    <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{dataset.format}</span>
                  </PropertyRow>
                  <PropertyRow label="Source">
                    <span className="max-w-[150px] truncate font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]" title={sourceLabel}>
                      {sourceLabel}
                    </span>
                  </PropertyRow>
                </>
              )}
              {layer.type !== "raster" && (
                <PropertyRow label="Points">
                  <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                    {(dataset?.metadata.pointCount ?? layer.pointCount)?.toLocaleString() ?? (frame?.n ?? 0).toLocaleString()}
                  </span>
                </PropertyRow>
              )}
              {(() => {
                const b = dataset?.metadata.bounds;
                const ext = b
                  ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
                  : layer.bounds
                    ? [layer.bounds[3] - layer.bounds[0], layer.bounds[4] - layer.bounds[1], layer.bounds[5] - layer.bounds[2]]
                    : null;
                return ext ? (
                  <PropertyRow label="Extent">
                    <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
                      {ext[0].toFixed(0)} × {ext[1].toFixed(0)} × {ext[2].toFixed(0)} m
                    </span>
                  </PropertyRow>
                ) : null;
              })()}
              {datasetFields.length > 0 && (
                <PropertyRow label="Fields">
                  <span className="max-w-[150px] truncate font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-3)]" title={datasetFields.join(", ")}>
                    {datasetFields.join(", ")}
                  </span>
                </PropertyRow>
              )}
              <PropertyRow label="Locked">
                <Switch label="" checked={layer.locked} onChange={(v) => updateLayer(layer.id, { locked: v })} />
              </PropertyRow>
            </Section>
          </>
        )}

        {track && (
          <>
            <div className="px-3 py-3">
              <div className="flex items-center gap-2">
                <Radio size={14} className="text-[var(--vp-accent)]" />
                <span className="text-[14px] font-semibold uppercase text-[var(--vp-text-1)]">{track.label}</span>
              </div>
              <div className="mt-1.5"><Chip tone="accent">TRK-{String(track.id).padStart(4, "0")}</Chip></div>
            </div>
            <Section title="Perception">
              <PropertyRow label="Class prob"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-success)]">{(track.conf * 100).toFixed(1)} %</span></PropertyRow>
              <PropertyRow label="L × W × H"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{track.box[3].toFixed(1)} × {track.box[4].toFixed(1)} × {track.box[5].toFixed(1)} m</span></PropertyRow>
              <PropertyRow label="Distance"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-warning)]">{Math.hypot(track.box[0], track.box[1]).toFixed(1)} m</span></PropertyRow>
              <PropertyRow label="Yaw"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{((track.box[6] * 180) / Math.PI).toFixed(0)}°</span></PropertyRow>
              {vel && (
                <PropertyRow label="Velocity">
                  <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-accent)]">
                    {vel[0].toFixed(1)}, {vel[1].toFixed(1)} m/s
                  </span>
                </PropertyRow>
              )}
            </Section>
          </>
        )}

        {probe && (
          <Section title="Point Probe">
            <PropertyRow label="X / Y / Z">
              <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">{probe.x.toFixed(2)} / {probe.y.toFixed(2)} / {probe.z.toFixed(2)}</span>
            </PropertyRow>
            <PropertyRow label="Range"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-warning)]">{probe.range.toFixed(2)} m</span></PropertyRow>
            <PropertyRow label="Intensity"><span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-success)]">{Math.round(probe.intensity * 255)} / 255</span></PropertyRow>
            <PropertyRow label="Coordinates">
              <button
                title="Copy coordinates"
                onClick={() => {
                  const text = `${probe.x.toFixed(3)}, ${probe.y.toFixed(3)}, ${probe.z.toFixed(3)}`;
                  void navigator.clipboard?.writeText(text).catch(() => undefined);
                }}
                className="vp-focusable rounded px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[11px] text-[var(--vp-text-3)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-accent)]">
                copy
              </button>
            </PropertyRow>
          </Section>
        )}
      </div>

      <div className="shrink-0 border-t" style={{ borderColor: "var(--vp-divider)" }}>
        <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
          <SectionTitleInline title="Camera 01" />
        </div>
        <div className="px-2.5 pb-2.5">
          <PiP inline />
        </div>
      </div>
    </div>
  );
}

function SectionTitleInline({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--vp-text-2)]">
      <span className="text-[var(--vp-accent)]"><Radio size={12} /></span>
      <span className="text-[11px] font-semibold">{title}</span>
    </div>
  );
}

/** CP5: measured display-stretch statistics — read live from the runtime so
 *  the Inspector reports the REAL numbers used by the display stretch. */
function StyleStatsRow({ datasetId }: { datasetId?: string }) {
  const rt = datasetId ? rasterRegistry.get(datasetId) : undefined;
  if (!rt?.stretchStats) {
    return (
      <PropertyRow label="Stretch">
        <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-3)]">auto (bit depth)</span>
      </PropertyRow>
    );
  }
  const { min, max } = rt.stretchStats;
  return (
    <PropertyRow label="Stretch (measured)">
      <span className="font-[var(--vp-font-mono)] text-[12px] text-[var(--vp-text-2)]">
        {Number.isInteger(min) ? min : min.toFixed(2)} … {Number.isInteger(max) ? max : max.toFixed(2)}
      </span>
    </PropertyRow>
  );
}
