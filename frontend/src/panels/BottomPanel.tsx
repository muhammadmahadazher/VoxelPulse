import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, Repeat, Terminal, Clock, PanelBottom, Maximize2 } from "lucide-react";
import { useStore } from "../store";
import { useUiStore } from "../stores/uiStore";
import { setStreamPaused } from "../ws";
import { IconButton, Chip, Tooltip, Segmented } from "../ui/kit";

/** Timeline dock — compact (transport + track + time, ~64px) or expanded
 *  (tabbed timeline/console). Collapsing the whole dock is ⌘J / rail. */
export function BottomPanel() {
  const timelineMode = useUiStore((s) => s.timelineMode);
  const setTimelineMode = useUiStore((s) => s.setTimelineMode);
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);

  if (timelineMode === "compact") {
    return (
      <div className="flex h-full flex-col">
        <TimelineRow compact />
        <button
          onClick={() => setTimelineMode("expanded")}
          title="Expand timeline" aria-label="Expand timeline"
          className="vp-focusable absolute right-2 top-1 flex h-[18px] items-center gap-1 rounded px-1 text-[9px] uppercase tracking-wider text-[var(--vp-text-3)] hover:text-[var(--vp-text-1)]">
          <Maximize2 size={9} /> expand
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[30px] shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: "var(--vp-divider)" }}>
        {(["timeline", "console"] as const).map((t) => (
          <button key={t} onClick={() => setBottomTab(t)}
            className={`vp-focusable flex min-h-[24px] items-center gap-1.5 rounded-[var(--vp-r-md)] px-2.5 text-[12px] font-medium capitalize transition-colors
              ${bottomTab === t ? "bg-[var(--vp-hover)] text-[var(--vp-text-1)]" : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"}`}>
            {t === "timeline" ? <Clock size={13} /> : <Terminal size={13} />}
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip text="Compact timeline">
            <IconButton icon={<PanelBottom size={13} />} onClick={() => setTimelineMode("compact")} label="Compact timeline" />
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {bottomTab === "timeline" ? <TimelineRow /> : <ConsoleTab />}
      </div>
    </div>
  );
}

function fmtTime(frames: number, fps = 30): string {
  const t = frames / fps;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function TimelineRow({ compact = false }: { compact?: boolean }) {
  const paused = useStore((s) => s.paused);
  const scrub = useStore((s) => s.scrub);
  const history = useStore((s) => s.history);
  const playSpeed = useStore((s) => s.playSpeed);
  const toggle = useStore((s) => s.toggle);
  const setScrub = useStore((s) => s.setScrub);
  const setPlaySpeed = useStore((s) => s.setPlaySpeed);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    if (!scrub.active || paused) return;
    const iv = setInterval(() => {
      const s = useStore.getState();
      const next = s.scrub.index + 1;
      s.setScrub(true, next >= s.history.length ? 0 : next);
    }, 1000 / 30 / playSpeed);
    return () => clearInterval(iv);
  }, [scrub.active, paused, playSpeed, scrub.index, setScrub]);

  const max = Math.max(0, history.length - 1);
  const pct = max > 0 ? (scrub.index / max) * 100 : 0;
  const seek = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el || !history.length) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setScrub(true, Math.round(frac * max));
  };

  const btn = (icon: React.ReactNode, title: string, run: () => void, disabled?: boolean) => (
    <Tooltip text={title}>
      <IconButton icon={icon} onClick={run} disabled={disabled} size="sm" label={title} />
    </Tooltip>
  );

  return (
    <div className={`flex flex-1 items-center gap-2.5 ${compact ? "px-3 py-1" : "flex-col items-stretch justify-center px-4 py-2"}`}>
      <div className="flex items-center gap-1.5">
        {btn(<SkipBack size={14} />, "Step back", () => setScrub(true, Math.max(0, scrub.index - 1)), !history.length)}
        <Tooltip text={paused && !scrub.active ? "Play (Space)" : "Pause (Space)"}>
          <button
            aria-label="Play / Pause"
            onClick={() => {
              if (scrub.active) { setScrub(false, 0); toggle("paused"); setStreamPaused(false); }
              else {
                const wasPaused = useStore.getState().paused;
                toggle("paused");
                setStreamPaused(!wasPaused);
              }
            }}
            className="vp-focusable flex h-[26px] w-[26px] items-center justify-center rounded-[var(--vp-r-md)] bg-[var(--vp-accent)] text-white hover:bg-[var(--vp-accent-hover)]">
            {paused && !scrub.active ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </Tooltip>
        {btn(<SkipForward size={14} />, "Step forward", () => setScrub(true, Math.min(max, scrub.index + 1)), !history.length)}
        {btn(<Repeat size={13} />, "Loop from start", () => setScrub(true, 0), !history.length)}
        <Segmented
          size="sm"
          value={String(playSpeed)}
          onChange={(v) => setPlaySpeed(+v)}
          options={[
            { id: "0.5", label: "0.5×" }, { id: "1", label: "1×" },
            { id: "2", label: "2×" }, { id: "4", label: "4×" },
          ]}
        />
      </div>

      {/* track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => { drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); seek(e); }}
        onPointerMove={(e) => drag.current && seek(e)}
        onPointerUp={() => { drag.current = false; }}
        className="group relative h-[22px] min-w-0 flex-1 cursor-pointer select-none"
        role="slider" aria-label="timeline" aria-valuenow={scrub.index} aria-valuemax={max}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setScrub(true, Math.max(0, scrub.index - 1));
          if (e.key === "ArrowRight") setScrub(true, Math.min(max, scrub.index + 1));
        }}>
        <div className="absolute left-0 right-0 top-[9px] h-[4px] rounded-full" style={{ background: "var(--vp-border-strong)" }} />
        <div className="absolute left-0 top-[9px] h-[4px] rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%`, background: "var(--vp-accent)" }} />
        {max > 0 && Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="absolute top-[13px] h-[5px] w-px" style={{ left: `${((i + 1) / 10) * 100}%`, background: "var(--vp-border-strong)" }} />
        ))}
        <div className="absolute top-[2px] h-[18px] w-[18px] -translate-x-1/2 rounded-full border-2 shadow-[var(--vp-shadow-1)] transition-transform group-hover:scale-110"
          style={{ left: `${pct}%`, background: "var(--vp-text-1)", borderColor: "var(--vp-accent)" }} />
      </div>

      <div className={`flex shrink-0 items-center gap-2 ${compact ? "" : "justify-end pb-0.5"}`}>
        <span className="whitespace-nowrap font-[var(--vp-font-mono)] text-[11px] text-[var(--vp-text-3)]">
          {scrub.active ? fmtTime(scrub.index) : "live"} / {fmtTime(max)}
        </span>
        <button
          onClick={() => { setScrub(false, 0); setPlaySpeed(1); }}
          aria-label="Return to live"
          className="vp-focusable rounded">
          <Chip tone={scrub.active ? "accent" : "success"}>{scrub.active ? "REPLAY" : "● LIVE"}</Chip>
        </button>
      </div>
    </div>
  );
}

declare global {
  interface Window { __vpLog?: { t: string; msg: string }[] }
}

export function ConsoleTab() {
  const lines = (typeof window !== "undefined" ? window.__vpLog : undefined) ?? [];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={ref} className="h-full overflow-y-auto px-4 py-2 font-[var(--vp-font-mono)] text-[11.5px] leading-relaxed">
      {lines.length === 0 && <div className="text-[var(--vp-text-3)]">no events yet</div>}
      {lines.map((l, i) => (
        <div key={i} className="text-[var(--vp-text-2)]">
          <span className="mr-2.5 text-[var(--vp-text-3)]">{l.t}</span>{l.msg}
        </div>
      ))}
    </div>
  );
}

export function appendConsole(msg: string) {
  if (typeof window === "undefined") return;
  window.__vpLog = [...(window.__vpLog ?? []), { t: new Date().toLocaleTimeString(), msg }].slice(-200);
}
