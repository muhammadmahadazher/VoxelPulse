import { useEffect, useRef } from "react";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorAfter?: boolean;
  run: () => void;
}

/** Generic right-click context menu (floating overlay chrome). */
export function ContextMenu({
  x, y, items, onClose,
}: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="vp-overlay vp-focusable fixed z-[80] min-w-[180px] rounded-md border py-1"
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - items.length * 28 - 16) }}
    >
      {items.map((it) => (
        <div key={it.id}>
          <button
            disabled={it.disabled}
            onClick={() => { it.run(); onClose(); }}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] transition-colors
              ${it.disabled ? "cursor-default text-[var(--vp-text-3)]"
                : it.danger ? "text-[var(--vp-error)] hover:bg-white/5" : "text-[var(--vp-text-1)] hover:bg-white/5"}`}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="ml-6 text-[10px] text-[var(--vp-text-3)]">{it.shortcut}</span>}
          </button>
          {it.separatorAfter && <div className="my-1 border-t border-[var(--vp-divider)]" />}
        </div>
      ))}
    </div>
  );
}
