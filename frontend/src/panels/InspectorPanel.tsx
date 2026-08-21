import { Crosshair, Layers as LayersIcon, Radio } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { useStore, OBJECT_VELOCITIES } from "../store";
import { PiP } from "../ui/PiP";

function Row({ label, value, mono = true, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--vp-divider)] py-1">
      <span className="text-[10px] uppercase tracking-wider text-[var(--vp-text-3)]">{label}</span>
      <span className={`text-[11px] ${mono ? "font-[var(--vp-font-mono)]" : ""} ${accent ?? "text-[var(--vp-text-1)]"}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[var(--vp-text-2)]">
      <span className="text-[var(--vp-accent)]">{icon}</span>
      <span className="text-[11px] font-semibold">{title}</span>
    </div>
  );
}

/** Contextual inspector: shows only fields relevant to the current selection. */
export function InspectorPanel() {
  const selection = useProjectStore((s) => s.selection);
  const layers = useProjectStore((s) => s.layers);
  const probe = useStore((s) => s.inspectPoint);
  const frame = useStore((s) => s.lastFrame);

  const layer = selection.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;
  const track = selection.kind === "track" ? frame?.objects.find((o) => o.id === selection.id) : undefined;
  const vel = selection.kind === "track" ? OBJECT_VELOCITIES[selection.id] : undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--vp-text-3)]">
        Inspector
      </div>

      {selection.kind === "none" && (
        <div className="rounded-md border border-dashed border-[var(--vp-border)] px-3 py-5 text-center text-[11px] leading-relaxed text-[var(--vp-text-3)]">
          Select a layer, a detection box,<br />or hover the point cloud.
        </div>
      )}

      {layer && (
        <section className="mb-4">
          <SectionTitle icon={<LayersIcon size={12} />} title={layer.name} />
          <Row label="Type" value={layer.type} />
          <Row label="Source" value={layer.source ? `${layer.source.kind} · ${layer.source.name}` : "—"} />
          {layer.pointCount != null && <Row label="Points" value={layer.pointCount.toLocaleString()} />}
          {layer.bounds && (
            <Row label="Bounds" value={`${(layer.bounds[3] - layer.bounds[0]).toFixed(0)} × ${(layer.bounds[4] - layer.bounds[1]).toFixed(0)} × ${(layer.bounds[5] - layer.bounds[2]).toFixed(0)} m`} />
          )}
          <Row label="Opacity" value={`${(layer.opacity * 100) | 0}%`} />
          <Row label="Locked" value={layer.locked ? "yes" : "no"} />
        </section>
      )}

      {track && (
        <section className="mb-4">
          <SectionTitle icon={<Radio size={12} />} title={`Detection · ${track.label}`} />
          <Row label="Track ID" value={`TRK-${String(track.id).padStart(4, "0")}`} accent="text-[var(--vp-accent)]" />
          <Row label="Class prob" value={`${(track.conf * 100).toFixed(1)} %`} accent="text-[var(--vp-success)]" />
          <Row label="L × W × H" value={`${track.box[3].toFixed(1)} × ${track.box[4].toFixed(1)} × ${track.box[5].toFixed(1)} m`} />
          <Row label="Distance" value={`${Math.hypot(track.box[0], track.box[1]).toFixed(1)} m`} accent="text-[var(--vp-highlight)]" />
          <Row label="Yaw" value={`${((track.box[6] * 180) / Math.PI).toFixed(0)}°`} />
          {vel && <Row label="Velocity" value={`${vel[0].toFixed(1)}, ${vel[1].toFixed(1)} m/s`} accent="text-[var(--vp-text-2)]" />}
        </section>
      )}

      {probe && (
        <section className="mb-4">
          <SectionTitle icon={<Crosshair size={12} />} title="Point Probe" />
          <Row label="X / Y / Z" value={`${probe.x.toFixed(2)} / ${probe.y.toFixed(2)} / ${probe.z.toFixed(2)}`} />
          <Row label="Range" value={`${probe.range.toFixed(2)} m`} accent="text-[var(--vp-highlight)]" />
          <Row label="Intensity" value={`${Math.round(probe.intensity * 255)} / 255`} accent="text-[var(--vp-success)]" />
        </section>
      )}

      <section className="mt-auto border-t border-[var(--vp-divider)] pt-3">
        <SectionTitle icon={<Radio size={12} />} title="Camera 01" />
        <PiP inline />
      </section>
    </div>
  );
}
