import { motion, AnimatePresence } from "framer-motion";
import { Crosshair } from "lucide-react";
import { useStore } from "../store";

/** Floating hover/click inspector tooltip: XYZ, range, intensity (0-255). */
export function Inspector() {
  const pt = useStore((s) => s.inspectPoint);
  const enabled = useStore((s) => s.inspectEnabled);
  const rulerActive = useStore((s) => s.rulerActive);
  const rulerPoints = useStore((s) => s.rulerPoints);
  if (!enabled || rulerActive) return null;
  return (
    <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 -translate-x-1/2">
      <AnimatePresence>
        {pt && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass mono flex items-center gap-3 rounded-lg px-3 py-1.5 text-[11px]"
          >
            <Crosshair size={12} className="text-cyan" />
            <span className="text-slate-400">X</span><span className="text-cyan">{pt.x.toFixed(2)}</span>
            <span className="text-slate-400">Y</span><span className="text-cyan">{pt.y.toFixed(2)}</span>
            <span className="text-slate-400">Z</span><span className="text-cyan">{pt.z.toFixed(2)}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">R</span><span className="text-violet-300">{pt.range.toFixed(1)}m</span>
            <span className="text-slate-400">I</span>
            <span className="text-emerald-300">{Math.round(pt.intensity * 255)}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {rulerPoints.length > 0 && (
        <div className="mono mt-1 text-center text-[10px] text-amber-300">
          {rulerPoints.length === 1 ? "click second point…" : ""}
        </div>
      )}
    </div>
  );
}
