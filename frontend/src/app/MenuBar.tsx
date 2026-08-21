import { useEffect, useRef } from "react";
import { useUiStore } from "../stores/uiStore";
import { useProjectStore } from "../stores/projectStore";
import { useStore } from "../store";
import type { MenuItem } from "./ContextMenu";

export interface MenuDef {
  id: string;
  label: string;
  items: MenuItem[];
}

/** Conventional application menu bar. Zero-fake-UI policy: only working items. */
export function MenuBar({
  menus,
}: {
  menus: MenuDef[];
  onAction?: (a: { kind: string }) => void;
}) {
  const menuOpen = useUiStore((s) => s.menuOpen);
  const setMenuOpen = useUiStore((s) => s.setMenuOpen);
  const barRef = useRef<HTMLDivElement>(null);
  const dirty = useProjectStore((s) => s.dirty);
  const meta = useProjectStore((s) => s.meta);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenuOpen(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [setMenuOpen]);

  return (
    <div
      ref={barRef}
      className="vp-panel relative z-40 flex h-8 select-none items-center gap-0.5 border-b px-2"
      role="menubar"
    >
      <span className="mr-3 ml-1 text-[12px] font-semibold tracking-wide text-[var(--vp-text-1)]">
        VoxelPulse
      </span>
      {menus.map((m) => (
        <div key={m.id} className="relative">
          <button
            role="menuitem"
            onClick={() => setMenuOpen(menuOpen === m.id ? null : m.id)}
            onMouseEnter={() => menuOpen && setMenuOpen(m.id)}
            className={`vp-focusable rounded px-2.5 py-1 text-[11px] transition-colors
              ${menuOpen === m.id
                ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]"
                : "text-[var(--vp-text-2)] hover:text-[var(--vp-text-1)]"}`}
          >
            {m.label}
          </button>
          {menuOpen === m.id && (
            <div
              role="menu"
              className="vp-overlay vp-focusable absolute left-0 top-full mt-1 min-w-[220px] rounded-md border py-1"
            >
              {m.items.map((it) => (
                <div key={it.id}>
                  <button
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => { setMenuOpen(null); it.run(); }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] transition-colors
                      ${it.disabled ? "cursor-default text-[var(--vp-text-3)]"
                        : it.danger ? "text-[var(--vp-error)] hover:bg-white/5" : "text-[var(--vp-text-1)] hover:bg-white/5"}`}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="ml-8 font-[var(--vp-font-mono)] text-[10px] text-[var(--vp-text-3)]">{it.shortcut}</span>}
                  </button>
                  {it.separatorAfter && <div className="my-1 border-t border-[var(--vp-divider)]" />}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="ml-auto flex items-center gap-3 pr-1 text-[10px] text-[var(--vp-text-3)]">
        <span className="font-[var(--vp-font-mono)]">
          {meta.name}{dirty ? " •" : ""}
        </span>
        <ModeBadge />
      </div>
    </div>
  );
}

function ModeBadge() {
  const mode = useStore((s) => s.mode);
  const label = mode === "live" ? "LIVE" : mode === "sim" ? "DEMO SCENE" : mode === "file" ? "FILE" : "…";
  const color = mode === "live" ? "var(--vp-success)" : mode === "sim" ? "var(--vp-highlight)" : "var(--vp-text-3)";
  return (
    <span
      className="rounded px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[9px] font-semibold tracking-wider"
      style={{ color, background: "rgba(255,255,255,0.04)" }}
    >
      {label}
    </span>
  );
}
