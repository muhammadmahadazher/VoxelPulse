import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, Repeat } from "lucide-react";
import { useStore } from "../store";
import { useUiStore } from "../stores/uiStore";
import { setStreamPaused } from "../ws";

/** Collapsible bottom dock: synchronized timeline replay + console log. */
export function BottomPanel() {
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);
  const paused = useStore((s) => s.paused);
  const scrub = useStore((s) => s.scrub);
  const history = useStore((s) => s.history);
  const playSpeed = useStore((s) => s.playSpeed);
  const toggle = useStore((s) => s.toggle);
  const setScrub = useStore((s) => s.setScrub);
  const setPlaySpeed = useStore((s) => s.setPlaySpeed);

  useEffect(() => {
    if (!scrub.active || paused) return;
    const iv = setInterval(() => {
      const s = useStore.getState();
      const next = s.scrub.index + 1;
      s.setScrub(true, next >= s.history.length ? 0 : next);
    }, 1000 / 30 / playSpeed);
    return () => clearInterval(iv);
  }, [scrub.active, paused, playSpeed, scrub.index, setScrub]);

  const iconBtn = "vp-focusable rounded border border-[var(--vp-border)] p-1 text-[var(--vp-text-2)] transition-colors hover:bg-white/5 hover:text-[var(--vp-text-1)] disabled:opacity-30";

  return (
    <div className="flex h-full flex-col">
      {/* tab strip */}
      <div className="flex h-8 items-center gap-1 border-b border-[var(--vp-divider)] px-2">
        {(["timeline", "console"] as const).map((t) => (
          <button key={t} onClick={() => setBottomTab(t)}
            className={`vp-focusable rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors
              ${bottomTab === t ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]" : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"}`}>
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button className={iconBtn} disabled={!history.length} onClick={() => setScrub(true, 0)} title="Loop from start">
            <Repeat size={11} />
          </button>
          <button className={iconBtn} disabled={!history.length} onClick={() => setScrub(true, Math.max(0, scrub.index - 1))} title="Step back">
            <SkipBack size={11} />
          </button>
          <button
            className={iconBtn}
            title="Play / Pause (Space)"
            onClick={() => {
              if (scrub.active) { setScrub(false, 0); toggle("paused"); setStreamPaused(false); }
              else {
                const wasPaused = useStore.getState().paused;
                toggle("paused");
                setStreamPaused(!wasPaused);
              }
            }}>
            {paused && !scrub.active ? <Play size={11} /> : <Pause size={11} />}
          </button>
          <button className={iconBtn} disabled={!history.length} onClick={() => setScrub(true, Math.min(history.length - 1, scrub.index + 1))} title="Step forward">
            <SkipForward size={11} />
          </button>
          {[0.5, 1, 2, 4].map((sp) => (
            <button key={sp} onClick={() => setPlaySpeed(sp)}
              className={`rounded px-1 font-[var(--vp-font-mono)] text-[9px] ${playSpeed === sp ? "text-[var(--vp-highlight)]" : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-2)]"}`}>
              {sp}×
            </button>
          ))}
          <button
            onClick={() => { setScrub(false, 0); setPlaySpeed(1); }}
            className={`ml-1 rounded px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[9px] font-semibold tracking-wider
              ${scrub.active ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]" : "bg-[rgba(52,211,153,0.12)] text-[var(--vp-success)]"}`}>
            {scrub.active ? "REPLAY" : "LIVE"}
          </button>
        </div>
      </div>

      {bottomTab === "timeline" ? <TimelineTab /> : <ConsoleTab />}
    </div>
  );
}

function TimelineTab() {
  const scrub = useStore((s) => s.scrub);
  const history = useStore((s) => s.history);
  const setScrub = useStore((s) => s.setScrub);
  const mode = useStore((s) => s.mode);
  return (
    <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-2">
      <input
        type="range" min={0} max={Math.max(0, history.length - 1)} value={scrub.index}
        disabled={!history.length}
        onChange={(e) => setScrub(true, +e.target.value)}
        className="w-full disabled:opacity-40"
        aria-label="timeline scrubber"
      />
      <div className="flex justify-between font-[var(--vp-font-mono)] text-[9px] text-[var(--vp-text-3)]">
        <span>{scrub.active ? `replay ${scrub.index + 1} / ${history.length}` : `live · buffer ${history.length} f`}</span>
        <span>{mode === "live" ? "live sensor" : "demo scene"}</span>
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
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-2 font-[var(--vp-font-mono)] text-[10px] leading-relaxed">
      {lines.length === 0 && <div className="text-[var(--vp-text-3)]">no events yet</div>}
      {lines.map((l, i) => (
        <div key={i} className="text-[var(--vp-text-2)]">
          <span className="mr-2 text-[var(--vp-text-3)]">{l.t}</span>{l.msg}
        </div>
      ))}
    </div>
  );
}

export function appendConsole(msg: string) {
  if (typeof window === "undefined") return;
  window.__vpLog = [...(window.__vpLog ?? []), { t: new Date().toLocaleTimeString(), msg }].slice(-200);
}
