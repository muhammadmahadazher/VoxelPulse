/** Reusable UI primitives (Phase 1.5 component system).
 *  One design system — no per-component one-off styling. See docs/design-system.md */
import { useEffect, useRef, useState, type ReactNode } from "react";

const base = "vp-focusable inline-flex items-center justify-center select-none transition-colors";

/* ---------------------------------------------- Button (primary/secondary) */
export function Button({
  children, onClick, variant = "secondary", size = "md", disabled, title,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" | "lg";
  disabled?: boolean; title?: string;
}) {
  const h = size === "lg" ? "var(--vp-ctl-xl)" : size === "sm" ? "var(--vp-ctl-sm)" : "var(--vp-ctl-md)";
  const look =
    variant === "primary"
      ? "bg-[var(--vp-accent)] text-[var(--vp-text-on-accent)] hover:bg-[var(--vp-accent-hover)] shadow-[var(--vp-shadow-1)]"
      : variant === "ghost"
        ? "text-[var(--vp-text-2)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]"
        : "vp-raised border text-[var(--vp-text-1)] hover:bg-[var(--vp-hover)]";
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`${base} gap-1.5 rounded-[var(--vp-r-md)] px-3 font-[var(--vp-font-ui)] text-[13px] font-medium disabled:opacity-40 disabled:pointer-events-none ${look}`}
      style={{ height: h }}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- ToolButton */
export function ToolButton({
  icon, label, onClick, active, disabled, title,
}: {
  icon: ReactNode; label?: string; onClick?: () => void; active?: boolean;
  disabled?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title ?? label}
      className={`${base} h-[var(--vp-ctl-md)] gap-1.5 rounded-[var(--vp-r-md)] px-2 text-[12.5px] font-medium disabled:opacity-35 disabled:pointer-events-none
        ${active
          ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]"
          : "text-[var(--vp-text-2)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)] active:bg-[var(--vp-accent-soft)]"}`}>
      <span style={{ width: "var(--vp-icon-md)", height: "var(--vp-icon-md)" }}>{icon}</span>
      {label && <span className="hidden xl:inline">{label}</span>}
    </button>
  );
}

/* ----------------------------------------------------------- IconButton */
export function IconButton({
  icon, onClick, active, disabled, danger, title, label, size = "md",
}: {
  icon: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean;
  danger?: boolean; title?: string; label?: string; size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "var(--vp-ctl-sm)" : "var(--vp-ctl-md)";
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={label}
      style={{ width: dim, height: dim }}
      className={`${base} rounded-[var(--vp-r-sm)] disabled:opacity-35 disabled:pointer-events-none
        ${active ? "text-[var(--vp-accent)]" : danger ? "text-[var(--vp-text-3)] hover:text-[var(--vp-error)]" : "text-[var(--vp-text-2)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]"}
        ${active ? "bg-[var(--vp-accent-soft)]" : ""}`}>
      <span style={{ width: "var(--vp-icon-sm)", height: "var(--vp-icon-sm)" }}>{icon}</span>
    </button>
  );
}

/* ------------------------------------------------------ SegmentedControl */
export function Segmented<T extends string>({
  options, value, onChange, size = "md",
}: {
  options: { id: T; label: string; icon?: ReactNode }[];
  value: T; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  const h = size === "sm" ? "var(--vp-ctl-sm)" : "var(--vp-ctl-md)";
  return (
    <div className="vp-focusable inline-flex rounded-[var(--vp-r-md)] border p-0.5" style={{ height: h, background: "var(--vp-hover)" }} role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} title={o.label}
          onClick={() => onChange(o.id)}
          className={`${base} gap-1 rounded-[calc(var(--vp-r-md)-2px)] px-2.5 text-[12px] font-medium
            ${value === o.id
              ? "bg-[var(--vp-panel)] text-[var(--vp-text-1)] shadow-[var(--vp-shadow-1)]"
              : "text-[var(--vp-text-3)] hover:text-[var(--vp-text-1)]"}`}>
          {o.icon && <span style={{ width: "var(--vp-icon-sm)", height: "var(--vp-icon-sm)" }}>{o.icon}</span>}
          <span className="hidden xl:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Switch */
export function Switch({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="vp-focusable flex w-full items-center justify-between py-1.5 text-[13px] text-[var(--vp-text-1)]">
      <span>{label}</span>
      <span className={`relative h-[16px] w-[28px] rounded-full transition-colors ${checked ? "bg-[var(--vp-accent)]" : "bg-[var(--vp-border-strong)]"}`}>
        <span className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all ${checked ? "left-[14px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- Slider */
export function Slider({
  value, min, max, step, onChange, label, format,
}: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; label?: string; format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3 py-1">
      {label && <span className="w-24 shrink-0 text-[12px] text-[var(--vp-text-2)]">{label}</span>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        aria-label={label}
        className="vp-focusable h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--vp-text-1)]
          [&::-webkit-slider-thumb]:shadow-[var(--vp-shadow-1)]"
        style={{ background: `linear-gradient(90deg, var(--vp-accent) ${pct}%, var(--vp-border-strong) ${pct}%)` }}
      />
      <span className="w-12 shrink-0 text-right font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-2)]">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ PropertyRow */
export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 py-1">
      <span className="text-[12.5px] text-[var(--vp-text-2)]">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- Stepper */
export function Stepper({ value, step = 0.1, min, max, onChange, format }: {
  value: number; step?: number; min: number; max: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="vp-raised flex items-center overflow-hidden rounded-[var(--vp-r-sm)] border">
      <button className="h-[22px] w-[22px] text-[13px] text-[var(--vp-text-2)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <span className="w-12 text-center font-[var(--vp-font-mono)] text-[11.5px] text-[var(--vp-text-1)]">
        {format ? format(value) : value.toFixed(step < 1 ? 2 : 0)}
      </span>
      <button className="h-[22px] w-[22px] text-[13px] text-[var(--vp-text-2)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]"
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
    </div>
  );
}

/* ------------------------------------------------------------ PanelHeader */
export function PanelHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex h-[34px] shrink-0 items-center justify-between border-b px-3">
      <span className="text-[12.5px] font-semibold tracking-wide text-[var(--vp-text-1)]">{title}</span>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Chip */
export function Chip({ children, tone = "neutral" }: {
  children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "error";
}) {
  const tones: Record<string, string> = {
    neutral: "text-[var(--vp-text-2)] bg-[var(--vp-hover)]",
    accent: "text-[var(--vp-accent)] bg-[var(--vp-accent-soft)]",
    success: "text-[var(--vp-success)] bg-[rgba(63,202,143,0.12)]",
    warning: "text-[var(--vp-warning)] bg-[rgba(226,163,54,0.12)]",
    error: "text-[var(--vp-error)] bg-[rgba(229,97,79,0.12)]",
  };
  return (
    <span className={`inline-flex items-center rounded-[var(--vp-r-sm)] px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[10.5px] font-semibold tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- EmptyState */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--vp-r-lg)] text-[var(--vp-text-3)]" style={{ background: "var(--vp-hover)" }}>
        {icon}
      </div>
      <div className="text-[13px] font-medium text-[var(--vp-text-2)]">{title}</div>
      {hint && <div className="max-w-[200px] text-[12px] leading-relaxed text-[var(--vp-text-3)]">{hint}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Tooltip */
export function Tooltip({ children, text, shortcut }: {
  children: ReactNode; text: string; shortcut?: string;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 500); }}
      onMouseLeave={() => { clearTimeout(timer.current); setShow(false); }}
    >
      {children}
      {show && (
        <span className="vp-floating pointer-events-none absolute bottom-full left-1/2 z-[90] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-[var(--vp-r-md)] border px-2 py-1 text-[12px] text-[var(--vp-text-1)]">
          {text}
          {shortcut && <span className="ml-2 font-[var(--vp-font-mono)] text-[11px] text-[var(--vp-text-3)]">{shortcut}</span>}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- useIsNarrow */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
