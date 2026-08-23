import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, Repeat, ChevronDown, Terminal, Clock } from "lucide-react";
import { useStore } from "../store";
import { useUiStore } from "../stores/uiStore";
import { setStreamPaused } from "../ws";
import { IconButton, Chip, Tooltip, Segmented } from "../ui/kit";

/** Production-grade timeline: custom ticked track, timecode, transport,
 *  speed control, LIVE/REPLAY indicator. Plus a console tab. */
export function BottomPanel() {
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);
  const panels = useUiStore((s) => s.panels);
  const togglePanel = useUiStore((s) => s.togglePanel);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: "var(--vp-divider)" }}>
        {(["timeline", "console"] as const).map((t) => (
          <button key={t} onClick={() => setBottomTab(t)}
            className={`vp-focusable flex min-h-[26px] items-center gap-1.5 rounded-[var(--vp-r-md)] px-2.5 text-[12px] font-medium capitalize transition-colors
              ${bottomTab === t ? "bg-[var(--vp-hover)] text-[var(--vp-text-1)]" : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"}`}>
            {t === "timeline" ? <Clock size={13} /> : <Terminal size={13} />}
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip text="Collapse panel" shortcut="⌘J">
            <IconButton icon={<ChevronDown size={14} />} onClick={() => togglePanel("bottom")} />
          </Tooltip>
        </div>
      </div>
      {bottomTab === "timeline" ? <TimelineTab /> : <ConsoleTab />}
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

function TimelineTab() {
  const paused = useStore((s) => s.paused);
  const scrub = useStore((s) => s.scrub);
  const history = useStore((s) => s.history);
  const playSpeed = useStore((s) => s.playSpeed);
  const toggle = useStore((s) => s.toggle);
  const setScrub = useStore((s) => s.setScrub);
  const setPlaySpeed = useStore((s) => s.setPlaySpeed);
  const trackRef = useRef<HTMLDivElement>(null);

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
      <IconButton icon={icon} onClick={run} disabled={disabled} />
    </Tooltip>
  );

  return (
    <div className="flex flex-1 flex-col justify-center gap-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        {btn(<SkipBack size={15} />, "Step back", () => setScrub(true, Math.max(0, scrub.index - 1)), !history.length)}
        <Tooltip text={paused && !scrub.active ? "Play (Space)" : "Pause (Space)"}>
          <button
            onClick={() => {
              if (scrub.active) { setScrub(false, 0); toggle("paused"); setStreamPaused(false); }
              else {
                const wasPaused = useStore.getState().paused;
                toggle("paused");
                setStreamPaused(!wasPaused);
              }
            }}
            className="vp-focusable flex h-[28px] w-[28px] items-center justify-center rounded-[var(--vp-r-md)] bg-[var(--vp-accent)] text-white hover:bg-[var(--vp-accent-hover)]">
            {paused && !scrub.active ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </Tooltip>
        {btn(<SkipForward size={15} />, "Step forward", () => setScrub(true, Math.min(max, scrub.index + 1)), !history.length)}
        {btn(<Repeat size={14} />, "Loop from start", () => setScrub(true, 0), !history.length)}

        <div className="mx-1.5 h-5 w-px" style={{ background: "var(--vp-divider)" }} />

        <Segmented
          size="sm"
          value={String(playSpeed)}
          onChange={(v) => setPlaySpeed(+v)}
          options={[
            { id: "0.5", label: "0.5×" }, { id: "1", label: "1×" },
            { id: "2", label: "2×" }, { id: "4", label: "4×" },
          ]}
        />

        <div className="ml-auto flex items-center gap-2.5">
          <span className="font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-3)]">
            {scrub.active ? fmtTime(scrub.index) : "live"} / {fmtTime(max)}
          </span>
          <button
            onClick={() => { setScrub(false, 0); setPlaySpeed(1); }}
            className="vp-focusable min-h-[22px] rounded px-2 font-[var(--vp-font-mono)] text-[10.5px] font-semibold tracking-wider">
            <Chip tone={scrub.active ? "accent" : "success"}>{scrub.active ? "REPLAY" : "● LIVE"}</Chip>
          </button>
        </div>
      </div>

      {/* timeline track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); seek(e); }}
        onPointerMove={(e) => e.buttons === 1 && seek(e)}
        className="group relative h-[22px] cursor-pointer select-none"
        role="slider" aria-label="timeline" aria-valuenow={scrub.index} aria-valuemax={max}>
        {/* track base */}
        <div className="absolute left-0 right-0 top-[9px] h-[4px] rounded-full" style={{ background: "var(--vp-border-strong)" }} />
        {/* elapsed fill */}
        <div className="absolute left-0 top-[9px] h-[4px] rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%`, background: "var(--vp-accent)" }} />
        {/* ticks */}
        {max > 0 && Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="absolute top-[13px] h-[5px] w-px" style={{ left: `${((i + 1) / 10) * 100}%`, background: "var(--vp-border-strong)" }} />
        ))}
        {/* thumb */}
        <div className="absolute top-[2px] h-[18px] w-[18px] -translate-x-1/2 rounded-full border-2 shadow-[var(--vp-shadow-1)] transition-transform group-hover:scale-110"
          style={{ left: `${pct}%`, background: "var(--vp-text-1)", borderColor: "var(--vp-accent)" }} />
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
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-2 font-[var(--vp-font-mono)] text-[11.5px] leading-relaxed">
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
