import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UploadCloud } from "lucide-react";
import { Viewport, type ViewportHandle } from "./scene/Viewport";
import { AppHeader } from "./app/AppHeader";
import { Shell } from "./app/Shell";
import { StatusBar } from "./app/StatusBar";
import { StartScreen, type StartAction } from "./app/StartScreen";
import { LayersPanel } from "./panels/LayersPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { BottomPanel, appendConsole } from "./panels/BottomPanel";
import { CommandPalette } from "./ui/CommandPalette";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { connectStream, setStreamPaused, loadStaticFrame, setSimScenario } from "./ws";
import { parsePointFile } from "./utils/fileParse";
import { exportScreenshot, exportPly, exportPcd } from "./utils/exporters";
import {
  serializeProject, deserializeProject, downloadProject, saveAutosave, applyProject,
} from "./utils/projectIo";
import { useStore } from "./store";
import { useUiStore } from "./stores/uiStore";
import { useProjectStore, type Layer } from "./stores/projectStore";

let layerSeq = 0;
const nextLayerId = () => `lyr-${Date.now().toString(36)}-${layerSeq++}`;

/** Default scene layers for a fresh project (stream-driven). */
function ensureDefaultLayers(mode: "demo" | "stream") {
  const p = useProjectStore.getState();
  if (p.layers.some((l) => l.source?.kind === "demo" || l.source?.kind === "stream")) return;
  const src = { kind: mode === "demo" ? ("demo" as const) : ("stream" as const), name: mode === "demo" ? "Demo Scene" : "Live Sensor" };
  const mk = (name: string, type: Layer["type"]): Layer => ({
    id: nextLayerId(), name, type, visible: true, locked: false, opacity: 1, source: src,
  });
  useProjectStore.setState({
    layers: [
      mk("LiDAR Point Cloud", "pointcloud"),
      mk("Detections & Tracks", "detections"),
      mk("Camera 01", "camera"),
      mk("Reference Frame", "reference"),
    ],
  });
}

export default function App() {
  const handleRef = useRef<ViewportHandle>(null);
  const mode = useStore((s) => s.mode);
  const projectOpen = useProjectStore((s) => s.open);
  const addInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);

  const ui = useUiStore();

  // theme attribute for light/dark token switching
  useEffect(() => {
    document.documentElement.dataset.theme = ui.colorMode;
  }, [ui.colorMode]);

  // ---- boot: connect stream but DO NOT auto-open a project (start screen first)
  useEffect(() => {
    connectStream();
    appendConsole("workspace ready — awaiting project");
    // deep link for testing / sharing: ?project=1 opens an empty project
    if (new URLSearchParams(location.search).get("project") === "1") {
      useProjectStore.getState().newProject();
    }
  }, []);

  useEffect(() => {
    if (projectOpen && (mode === "sim" || mode === "live")) ensureDefaultLayers(mode === "sim" ? "demo" : "stream");
  }, [projectOpen, mode]);

  // autosave every 30 s when dirty
  useEffect(() => {
    const iv = setInterval(() => {
      const p = useProjectStore.getState();
      if (p.open && p.dirty) saveAutosave(serializeProject(handleRef.current?.camera() ?? null, useStore.getState().viewLayout));
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // ---- project actions ----------------------------------------------------
  const newProject = () => {
    useProjectStore.getState().newProject();
    appendConsole("new project created");
  };

  const saveProject = (saveAs: boolean) => {
    const p = useProjectStore.getState();
    if (!p.open) return;
    const name = saveAs || !p.savedRef ? (p.meta.name || "project") + ".vxp" : p.savedRef;
    if (saveAs || !p.savedRef) {
      const typed = window.prompt("Save project as (.vxp):", name);
      if (!typed) return;
      useProjectStore.getState().markSaved(typed.endsWith(".vxp") ? typed : typed + ".vxp");
    }
    const doc = serializeProject(handleRef.current?.camera() ?? null, useStore.getState().viewLayout);
    downloadProject(useProjectStore.getState().savedRef ?? name, doc);
    saveAutosave(doc);
    appendConsole(`project saved — ${useProjectStore.getState().savedRef ?? name}`);
  };

  const openProject = () => {
    openInputRef.current?.click();
  };

  const addData = () => {
    addInputRef.current?.click();
  };

  const importFile = async (file: File) => {
    if (!useProjectStore.getState().open) useProjectStore.getState().newProject();
    try {
      const buf = await file.arrayBuffer();
      const frame = parsePointFile(file.name, buf);
      loadStaticFrame(frame, file.name);
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < frame.n; i++) {
        for (let k = 0; k < 3; k++) {
          const v = frame.positions[i * 3 + k];
          if (v < mn[k]) mn[k] = v;
          if (v > mx[k]) mx[k] = v;
        }
      }
      useProjectStore.getState().addLayer({
        id: nextLayerId(), name: file.name, type: "pointcloud", visible: true,
        locked: false, opacity: 1, source: { kind: "file", name: file.name },
        pointCount: frame.n,
        bounds: [mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]],
      });
      appendConsole(`imported ${file.name} — ${frame.n.toLocaleString()} points`);
    } catch (e) {
      setNotice({ text: `Could not open ${file.name}`, detail: (e as Error).message });
    }
  };

  const startExample = (example: string) => {
    useProjectStore.getState().newProject();
    setSimScenario(example as "urban" | "warehouse" | "drone");
    useStore.setState({ colormap: "height" });
    appendConsole(`demo scene loaded — ${example}`);
  };

  // ---- layer visibility → renderer bridges -------------------------------
  useEffect(() => {
    return useProjectStore.subscribe((s) => {
      const t = useStore.getState();
      const byType = (type: Layer["type"]) => s.layers.find((l) => l.type === type);
      const pts = byType("pointcloud");
      if (pts && pts.visible !== t.showPoints) useStore.setState({ showPoints: pts.visible });
      const det = byType("detections");
      if (det && det.visible !== t.showBoxes) useStore.setState({ showBoxes: det.visible });
      const ref = byType("reference");
      if (ref && ref.visible !== t.showRadar) useStore.setState({ showRadar: ref.visible });
    });
  }, []);

  // ---- drag & drop --------------------------------------------------------
  useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file?.name.toLowerCase().endsWith(".vxp")) return;
      if (file) void importFile(file);
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

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onSaveAs = () => saveProject(true);
    document.addEventListener("vp-save-as", onSaveAs);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); s.toggle("paletteOpen"); return; }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); openProject(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(e.shiftKey); return; }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); useUiStore.getState().togglePanel("left"); return; }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); useUiStore.getState().togglePanel("bottom"); return; }
      if (e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); useUiStore.getState().toggleMaximized(); return; }
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
      else if (e.key === "s" || e.key === "S") exportScreenshot();
      else if (e.key === "e" || e.key === "E") exportPly();
      else if (e.key === "Escape") { useProjectStore.getState().select({ kind: "none" }); s.clearRuler(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("vp-save-as", onSaveAs);
    };
  }, []);

  // ---- menus (zero fake UI) -----------------------------------------------
  const menus = [
    {
      id: "file", label: "File",
      items: [
        { id: "new", label: "New Project", run: newProject },
        { id: "open", label: "Open Project…", shortcut: "⌘O", run: openProject },
        { id: "save", label: "Save", shortcut: "⌘S", run: () => saveProject(false), disabled: !projectOpen },
        { id: "saveAs", label: "Save As…", shortcut: "⇧⌘S", separatorAfter: true, run: () => saveProject(true), disabled: !projectOpen },
        { id: "add", label: "Add Point Cloud…", run: addData },
      ],
    },
    {
      id: "view", label: "View",
      items: [
        { id: "vp-left", label: "Layers Panel", shortcut: "⌘B", run: () => useUiStore.getState().togglePanel("left") },
        { id: "vp-right", label: "Inspector", run: () => useUiStore.getState().togglePanel("right") },
        { id: "vp-bottom", label: "Timeline / Console", shortcut: "⌘J", run: () => useUiStore.getState().togglePanel("bottom") },
        { id: "vp-max", label: "Maximize Viewport", shortcut: "⇧F", separatorAfter: true, run: () => useUiStore.getState().toggleMaximized() },
        { id: "vp-theme", label: "Light / Dark Theme", run: () => useUiStore.getState().toggleColorMode() },
        { id: "vp-pres", label: "Presentation Mode", separatorAfter: true, run: () => useUiStore.getState().toggleTheme() },
        { id: "cam-orbit", label: "Camera: Orbit Reset", shortcut: "R", run: () => handleRef.current?.reset() },
        { id: "cam-top", label: "Camera: Top-Down", shortcut: "T", run: () => handleRef.current?.topDown() },
        { id: "cam-chase", label: "Camera: Chase", shortcut: "F", run: () => handleRef.current?.chase() },
      ],
    },
    {
      id: "data", label: "Data",
      items: [
        { id: "d-add", label: "Add Point Cloud…", run: addData },
        { id: "d-ply", label: "Export Selection → .PLY", shortcut: "E", run: exportPly },
        { id: "d-pcd", label: "Export Selection → .PCD", run: exportPcd },
        { id: "d-png", label: "Snapshot (4K PNG)", shortcut: "S", separatorAfter: true, run: exportScreenshot },
        { id: "d-scen", label: "Demo Scene: Urban", run: () => startExample("urban") },
        { id: "d-scen2", label: "Demo Scene: Warehouse", run: () => startExample("warehouse") },
        { id: "d-scen3", label: "Demo Scene: Drone", run: () => startExample("drone") },
      ],
    },
    {
      id: "help", label: "Help",
      items: [
        {
          id: "h-keys", label: "Keyboard Shortcuts", run: () =>
            setNotice({
              text: "Shortcuts",
              detail: "⌘K palette · ⌘O open · ⌘S save · ⌘B layers · ⌘J timeline · ⇧F maximize · Space pause · V layout · C colormap · M ruler · X crop · R/T/F cameras · S snapshot · E export · Esc deselect",
            }),
        },
        {
          id: "h-about", label: "About VoxelPulse", run: () =>
            setNotice({ text: "VoxelPulse v4 — Spatial Computing Studio", detail: "Open-source · MIT · github.com/muhammadmahadazher/VoxelPulse" }),
        },
      ],
    },
  ];

  const onZoomTo = (layer: Layer) => {
    if (layer.bounds) handleRef.current?.frameBounds(layer.bounds);
    else handleRef.current?.reset();
  };

  const startAction = (a: StartAction) => {
    if (a.kind === "new") newProject();
    else if (a.kind === "open") openProject();
    else if (a.kind === "addData") addData();
    else if (a.kind === "shortcuts") menus[3].items[0].run();
    else if (a.kind === "example" && a.example) startExample(a.example);
  };

  const onAddInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await importFile(file);
  };
  const onOpenInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const doc = deserializeProject(JSON.parse(await file.text()));
      const restored = applyProject(doc);
      if (restored.viewLayout === "split" || restored.viewLayout === "fusion")
        useStore.getState().setViewLayout(restored.viewLayout);
      if (restored.camera) handleRef.current?.restoreCamera(restored.camera);
      useProjectStore.getState().markSaved(file.name);
      appendConsole(`project opened — ${file.name} (${doc.layers.length} layers)`);
    } catch (err) {
      setNotice({ text: `Could not open ${file.name}`, detail: (err as Error).message });
    }
  };

  return (
    <Shell
      header={<AppHeader menus={menus} onAddData={addData} onMaximize={() => useUiStore.getState().toggleMaximized()} />}
      leftPanel={<LayersPanel onZoomTo={onZoomTo} onAddData={addData} />}
      rightPanel={<InspectorPanel />}
      bottomPanel={<BottomPanel />}
      statusBar={<StatusBar />}
      leftWidth={ui.layout.leftWidth}
      rightWidth={ui.layout.rightWidth}
      bottomHeight={ui.layout.bottomHeight}
      leftOpen={ui.panels.left && projectOpen}
      rightOpen={ui.panels.right && projectOpen}
      bottomOpen={ui.panels.bottom && projectOpen}
      onResize={ui.setLayout}
      canvasOverlay={projectOpen ? <ProbeChip /> : null}
    >
      {/* persistent, accessible file inputs (hidden chrome) */}
      <input ref={addInputRef} type="file" id="vp-add-data" aria-hidden
        accept=".las,.ply,.pcd,.xyz,.txt,.pts" className="hidden" onChange={onAddInput} />
      <input ref={openInputRef} type="file" id="vp-open-project" aria-hidden
        accept=".vxp,application/json" className="hidden" onChange={onOpenInput} />

      <ErrorBoundary>
        <Viewport handleRef={handleRef} />
      </ErrorBoundary>

      <AnimatePresence>
        {!projectOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StartScreen onAction={startAction} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragOver && projectOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[var(--vp-accent)]/60"
            style={{ background: "var(--vp-accent-soft)" }}>
            <div className="vp-floating flex flex-col items-center gap-2 rounded-[var(--vp-r-lg)] border px-10 py-8">
              <UploadCloud size={30} className="text-[var(--vp-accent)]" />
              <div className="text-[13px] text-[var(--vp-text-1)]">drop .las / .ply / .pcd / .xyz to add a layer</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setNotice(null)}
            className="vp-floating absolute left-1/2 top-4 z-50 w-[440px] -translate-x-1/2 cursor-pointer rounded-[var(--vp-r-lg)] border p-4"
          >
            <div className="text-[13px] font-semibold text-[var(--vp-text-1)]">{notice.text}</div>
            {notice.detail && <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--vp-text-2)]">{notice.detail}</div>}
            <div className="mt-2 text-[11.5px] text-[var(--vp-text-3)]">click to dismiss</div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette />
    </Shell>
  );
}

/** Cursor probe chip floating above the canvas (details also in inspector). */
function ProbeChip() {
  const pt = useStore((s) => s.inspectPoint);
  const rulerActive = useStore((s) => s.rulerActive);
  if (!pt || rulerActive) return null;
  return (
    <div className="vp-floating pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-[var(--vp-r-md)] border px-3 py-1.5 font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-2)]">
      X {pt.x.toFixed(2)} · Y {pt.y.toFixed(2)} · Z {pt.z.toFixed(2)} · R {pt.range.toFixed(1)} m · I {Math.round(pt.intensity * 255)}
    </div>
  );
}
