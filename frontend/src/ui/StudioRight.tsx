import { useState } from "react";
import { motion } from "framer-motion";
import { PanelRightClose, Crosshair, Radar, X } from "lucide-react";
import { useStore, OBJECT_VELOCITIES } from "../store";
import { PiP } from "./PiP";

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/5 py-1">
      <span className="mono text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`mono text-[11px] ${accent ?? "text-slate-200"}`}>{value}</span>
    </div>
  );
}

/** Right dock: inspector drawer for selected track / point + camera feed. */
export function StudioRight() {
  const [open, setOpen] = useState(true);
  const selectedTrack = useStore((s) => s.selectedTrack);
  const frame = useStore((s) => s.lastFrame);
  const inspect = useStore((s) => s.inspectPoint);
  const obj = frame?.objects.find((o) => o.id === selectedTrack) ?? null;
  const vel = selectedTrack != null ? OBJECT_VELOCITIES[selectedTrack] : undefined;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="glass absolute right-3 top-16 z-20 flex h-10 w-6 items-center justify-center rounded-l-xl border-white/10">
        <PanelRightClose size={14} className="rotate-180 text-sky-400" />
      </button>
    );
  }
  return (
    <motion.aside
      initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      className="glass absolute bottom-32 right-3 top-16 z-20 flex w-64 flex-col gap-2 overflow-y-auto rounded-xl border-white/10 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] font-bold tracking-[0.2em] text-slate-300">INSPECTOR</span>
        <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200">
          <PanelRightClose size={13} />
        </button>
      </div>

      {obj ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="mono text-xs font-bold uppercase text-sky-300">{obj.label}</span>
            <button onClick={() => useStore.getState().selectTrack(null)} className="text-slate-500 hover:text-slate-200">
              <X size={12} />
            </button>
          </div>
          <Field label="Track UUID" value={`TRK-${String(obj.id).padStart(4, "0")}`} accent="text-sky-300" />
          <Field label="Class Prob" value={`${(obj.conf * 100).toFixed(1)} %`} accent="text-emerald-300" />
          <Field label="Dims L×W×H" value={`${obj.box[3].toFixed(1)} × ${obj.box[4].toFixed(1)} × ${obj.box[5].toFixed(1)} m`} />
          <Field label="Position" value={`${obj.box[0].toFixed(1)}, ${obj.box[1].toFixed(1)}, ${obj.box[2].toFixed(1)}`} />
          <Field label="Distance" value={`${Math.hypot(obj.box[0], obj.box[1]).toFixed(1)} m`} accent="text-amber-400" />
          <Field label="Yaw" value={`${((obj.box[6] * 180) / Math.PI).toFixed(0)}°`} />
          <Field label="Velocity" value={vel ? `${vel[0].toFixed(1)}, ${vel[1].toFixed(1)} m/s` : "—"} accent="text-violet-300" />
          <Field label="Speed" value={vel ? `${Math.hypot(vel[0], vel[1]).toFixed(1)} m/s` : "—"} accent="text-violet-300" />
        </div>
      ) : (
        <div className="mono rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[10px] leading-relaxed text-slate-500">
          click a bounding box<br />to inspect the track
        </div>
      )}

      <div className="mt-1 border-t border-white/5 pt-2">
        <div className="mb-1 flex items-center gap-1.5">
          <Crosshair size={11} className="text-amber-400" />
          <span className="mono text-[9px] uppercase tracking-wider text-slate-500">Point Probe</span>
        </div>
        {inspect ? (
          <div>
            <Field label="X / Y / Z" value={`${inspect.x.toFixed(2)} / ${inspect.y.toFixed(2)} / ${inspect.z.toFixed(2)}`} />
            <Field label="Range" value={`${inspect.range.toFixed(2)} m`} accent="text-amber-400" />
            <Field label="Intensity" value={`${Math.round(inspect.intensity * 255)} / 255`} accent="text-emerald-300" />
          </div>
        ) : (
          <div className="mono px-1 text-[10px] text-slate-600">hover the cloud…</div>
        )}
      </div>

      <div className="mt-1 border-t border-white/5 pt-2">
        <div className="mb-1 flex items-center gap-1.5">
          <Radar size={11} className="text-sky-400" />
          <span className="mono text-[9px] uppercase tracking-wider text-slate-500">Camera 01</span>
        </div>
        <PiP inline />
      </div>
    </motion.aside>
  );
}
