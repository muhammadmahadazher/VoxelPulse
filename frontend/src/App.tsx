import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UploadCloud } from "lucide-react";
import { Viewport, type ViewportHandle } from "./scene/Viewport";
import { HudBar } from "./ui/HudBar";
import { PiP } from "./ui/PiP";
import { LeftPanel } from "./ui/LeftPanel";
import { TelemetryStrip } from "./ui/TelemetryStrip";
import { Inspector } from "./ui/Inspector";
import { CommandPalette } from "./ui/CommandPalette";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { connectStream, setStreamPaused, loadStaticFrame } from "./ws";
import { parsePointFile } from "./utils/fileParse";
import { useStore } from "./store";

export default function App() {
  const handleRef = useRef<ViewportHandle>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    connectStream();
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); s.toggle("paletteOpen"); return;
      }
      if (e.code === "Space") { e.preventDefault(); s.toggle("paused"); setStreamPaused(!s.paused ? true : false); }
      else if (e.key === "r" || e.key === "R") handleRef.current?.reset();
      else if (e.key === "t" || e.key === "T") handleRef.current?.topDown();
      else if (e.key === "f" || e.key === "F") handleRef.current?.chase();
      else if (e.key === "c" || e.key === "C") s.cycleColormap();
      else if (e.key === "m" || e.key === "M") s.toggle("rulerActive");
      else if (e.key === "s" || e.key === "S") import("./utils/exporters").then((m) => m.exportScreenshot());
      else if (e.key === "e" || e.key === "E") import("./utils/exporters").then((m) => m.exportPly());
    };
    const onCam = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "orbit") handleRef.current?.reset();
      if (detail === "top") handleRef.current?.topDown();
      if (detail === "chase") handleRef.current?.chase();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("vp-camera", onCam);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("vp-camera", onCam);
    };
  }, []);

  // drag & drop point cloud loader
  useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      file.arrayBuffer()
        .then((buf) => {
          const frame = parsePointFile(file.name, buf);
          loadStaticFrame(frame, file.name);
          setDropError(null);
        })
        .catch((err: Error) => setDropError(err.message));
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#090a0f]">
      <ErrorBoundary>
        <Viewport handleRef={handleRef} />
      </ErrorBoundary>
      <HudBar />
      <PiP />
      <LeftPanel />
      <Inspector />
      <TelemetryStrip />
      <CommandPalette />

      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-cyan/60 bg-cyan/5"
          >
            <div className="glass flex flex-col items-center gap-2 rounded-2xl px-10 py-8">
              <UploadCloud size={36} className="text-cyan" />
              <div className="mono text-sm text-cyan">drop .ply / .pcd / .xyz to load point cloud</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dropError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mono absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300"
            onClick={() => setDropError(null)}
          >
            {dropError} · click to dismiss
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
