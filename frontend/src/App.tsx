import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UploadCloud, LayoutGrid, Columns2, Focus } from "lucide-react";
import { Viewport, type ViewportHandle } from "./scene/Viewport";
import { HudBar } from "./ui/HudBar";
import { StudioLeft } from "./ui/StudioLeft";
import { StudioRight } from "./ui/StudioRight";
import { StudioBottom } from "./ui/StudioBottom";
import { Inspector } from "./ui/Inspector";
import { CommandPalette } from "./ui/CommandPalette";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { connectStream, setStreamPaused, loadStaticFrame } from "./ws";
import { parsePointFile } from "./utils/fileParse";
import { useStore, type ViewLayout } from "./store";

const LAYOUT_TABS: { id: ViewLayout; label: string; icon: React.ReactNode }[] = [
  { id: "single", label: "3D", icon: <LayoutGrid size={11} /> },
  { id: "split", label: "3D + BEV", icon: <Columns2 size={11} /> },
  { id: "fusion", label: "FUSION", icon: <Focus size={11} /> },
];

export default function App() {
  const handleRef = useRef<ViewportHandle>(null);
  const viewLayout = useStore((s) => s.viewLayout);
  const setViewLayout = useStore((s) => s.setViewLayout);
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    connectStream();
    // deep-linkable view layout: ?layout=split|fusion
    const q = new URLSearchParams(location.search).get("layout");
    if (q === "split" || q === "fusion") useStore.getState().setViewLayout(q);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); s.toggle("paletteOpen"); return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (s.scrub.active) { s.setScrub(false, 0); s.toggle("paused"); setStreamPaused(false); }
        else { s.toggle("paused"); setStreamPaused(!s.paused); }
      }
      else if (e.key === "r" || e.key === "R") handleRef.current?.reset();
      else if (e.key === "t" || e.key === "T") handleRef.current?.topDown();
      else if (e.key === "f" || e.key === "F") handleRef.current?.chase();
      else if (e.key === "c" || e.key === "C") s.cycleColormap();
      else if (e.key === "m" || e.key === "M") s.toggle("rulerActive");
      else if (e.key === "x" || e.key === "X") s.toggle("showCropGizmo");
      else if (e.key === "v" || e.key === "V") s.cycleViewLayout();
      else if (e.key === "s" || e.key === "S") import("./utils/exporters").then((m) => m.exportScreenshot());
      else if (e.key === "e" || e.key === "E") import("./utils/exporters").then((m) => m.exportPly());
      else if (e.key === "Escape") { s.selectTrack(null); s.clearRuler(); }
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
    <div className="relative h-screen w-screen overflow-hidden bg-[#07080B]">
      <ErrorBoundary>
        <Viewport handleRef={handleRef} />
      </ErrorBoundary>

      {/* viewport layout switcher */}
      <div className="glass absolute left-1/2 top-16 z-20 flex -translate-x-1/2 gap-1 rounded-lg border-white/10 p-1">
        {LAYOUT_TABS.map((t) => (
          <button key={t.id} onClick={() => setViewLayout(t.id)}
            className={`mono flex items-center gap-1 rounded px-2 py-1 text-[9px] font-semibold tracking-wider transition ${
              viewLayout === t.id ? "bg-sky-400/20 text-sky-300" : "text-slate-400 hover:text-slate-200"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <HudBar />
      <StudioLeft />
      <StudioRight />
      <StudioBottom />
      <Inspector />
      <CommandPalette />

      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-sky-400/60 bg-sky-400/5"
          >
            <div className="glass flex flex-col items-center gap-2 rounded-2xl border-white/10 px-10 py-8">
              <UploadCloud size={36} className="text-sky-400" />
              <div className="mono text-sm text-sky-300">drop .las / .ply / .pcd / .xyz to load</div>
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
