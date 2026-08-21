import { useEffect, useRef } from "react";
import { Viewport, type ViewportHandle } from "./scene/Viewport";
import { HudBar } from "./ui/HudBar";
import { PiP } from "./ui/PiP";
import { LeftPanel } from "./ui/LeftPanel";
import { TelemetryStrip } from "./ui/TelemetryStrip";
import { connectStream } from "./ws";
import { useStore, type Colormap } from "./store";
import { ErrorBoundary } from "./ui/ErrorBoundary";

const COLORMAPS: Colormap[] = ["turbo", "viridis", "cyber"];

export default function App() {
  const handleRef = useRef<ViewportHandle>(null);

  useEffect(() => {
    connectStream();
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useStore.getState();
      if (e.code === "Space") { e.preventDefault(); s.toggle("paused"); }
      else if (e.key === "r" || e.key === "R") handleRef.current?.reset();
      else if (e.key === "t" || e.key === "T") handleRef.current?.topDown();
      else if (e.key === "c" || e.key === "C")
        s.setColormap(COLORMAPS[(COLORMAPS.indexOf(s.colormap) + 1) % 3]);
      else if (e.key === "f" || e.key === "F") handleRef.current?.chase();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-void">
      <ErrorBoundary>
        <Viewport handleRef={handleRef} />
      </ErrorBoundary>
      <HudBar />
      <PiP />
      <LeftPanel />
      <TelemetryStrip />
    </div>
  );
}
