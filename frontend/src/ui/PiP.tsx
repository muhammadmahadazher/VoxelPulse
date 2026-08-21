import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { useStore } from "../store";

/** Picture-in-Picture synthetic RGB feed with synchronized 2D bounding boxes. */
export function PiP() {
  const frame = useStore((s) => s.lastFrame);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame) return;
    if (cv.width !== frame.camW) { cv.width = frame.camW; cv.height = frame.camH; }
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(frame.camW, frame.camH);
    img.data.set(frame.camRGB);
    // RGB -> RGBA
    const d = img.data, s = frame.camRGB;
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame]);

  return (
    <motion.div
      initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.15 }}
      className="glass absolute right-4 top-20 z-20 w-64 overflow-hidden rounded-xl p-2"
    >
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <Camera size={12} className="text-cyan" />
        <span className="mono text-[10px] tracking-widest text-slate-400">RGB SENSOR · SYNCED</span>
        <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="w-full rounded-lg" />
        {frame?.objects2d.slice(0, 10).map((o) => (
          <div key={o.id}
            className="absolute rounded-sm"
            style={{
              left: `${o.u * 100}%`, top: `${o.v * 100}%`,
              width: `${o.w * 100}%`, height: `${o.h * 100}%`,
              border: "1px solid #00F5FF",
              boxShadow: "0 0 6px rgba(0,245,255,0.5)",
            }}>
            <span className="mono absolute -top-4 left-0 whitespace-nowrap text-[9px] text-cyan">
              {o.label}
            </span>
          </div>
        ))}
        {/* sensor alignment crosshair */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px bg-cyan/20" />
          <div className="absolute top-1/2 left-0 h-px w-full bg-cyan/20" />
        </div>
      </div>
    </motion.div>
  );
}
