import { useCallback, useRef, type ReactNode } from "react";
import { Layers, PanelRight, PanelBottom, Search, Maximize2 } from "lucide-react";
import { useUiStore } from "../stores/uiStore";
import { useStore } from "../store";
import { useMediaQuery, Tooltip } from "../ui/kit";

/** Resizable workstation shell: header top, activity rail + docked panels
 *  around the canvas, status bar bottom. Architectural (square) dock edges,
 *  near-invisible dividers with generous hitboxes. */
export function Shell({
  header, leftPanel, rightPanel, bottomPanel, statusBar, children,
  leftWidth, rightWidth, bottomHeight,
  leftOpen, rightOpen, bottomOpen,
  onResize, canvasOverlay,
}: {
  header: ReactNode;
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  bottomPanel: ReactNode;
  statusBar: ReactNode;
  children: ReactNode;
  leftWidth: number; rightWidth: number; bottomHeight: number;
  leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean;
  onResize: (patch: { leftWidth?: number; rightWidth?: number; bottomHeight?: number }) => void;
  canvasOverlay?: ReactNode;
}) {
  const drag = useRef<null | "left" | "right" | "bottom">(null);
  const narrow = useMediaQuery("(max-width: 1365px)");
  const panels = useUiStore((s) => s.panels);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const maximized = useUiStore((s) => s.maximized);
  const toggleMaximized = useUiStore((s) => s.toggleMaximized);
  const togglePalette = useStore((s) => s.toggle);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
    if (drag.current === "left") onResize({ leftWidth: clamp(e.clientX - 46, 200, 420) });
    if (drag.current === "right") onResize({ rightWidth: clamp(window.innerWidth - e.clientX, 240, 460) });
    if (drag.current === "bottom") onResize({ bottomHeight: clamp(window.innerHeight - e.clientY - 26, 120, 420) });
  }, [onResize]);
  const stop = useCallback(() => {
    drag.current = null;
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stop);
  }, [onPointerMove]);
  const start = (which: "left" | "right" | "bottom") => (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = which;
    document.body.style.cursor = which === "bottom" ? "row-resize" : "col-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
  };
  void narrow;

  const effectiveLeft = leftOpen && !maximized;
  const effectiveRight = rightOpen && !maximized;
  const effectiveBottom = bottomOpen; // maximize hides side panels only — the compact dock stays

  const divider = (which: "left" | "right" | "bottom", className: string) => (
    <div onPointerDown={start(which)} className={`group absolute z-10 ${className}`}>
      <div className="h-full w-full transition-colors group-hover:bg-[var(--vp-accent)]/50" />
    </div>
  );

  const railBtn = (icon: ReactNode, title: string, active: boolean, onClick: () => void, shortcut?: string) => (
    <Tooltip text={title} shortcut={shortcut}>
      <button onClick={onClick}
        className={`vp-focusable flex h-[var(--vp-ctl-lg)] w-[var(--vp-ctl-lg)] items-center justify-center rounded-[var(--vp-r-md)] transition-colors
          ${active ? "bg-[var(--vp-accent-soft)] text-[var(--vp-accent)]" : "text-[var(--vp-text-3)] hover:bg-[var(--vp-hover)] hover:text-[var(--vp-text-1)]"}`}>
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden font-[var(--vp-font-ui)] text-[var(--vp-text-1)]" style={{ background: "var(--vp-canvas)" }}>
      {header}
      <div className="flex min-h-0 flex-1">
        {/* activity rail */}
        <nav className="vp-chrome flex w-[var(--vp-rail-w)] shrink-0 flex-col items-center gap-1 border-r py-2">
          {railBtn(<Layers size={18} />, "Layers", panels.left, () => togglePanel("left"), "⌘B")}
          {railBtn(<PanelRight size={18} />, "Inspector", panels.right, () => togglePanel("right"))}
          {railBtn(<PanelBottom size={18} />, "Timeline / console", panels.bottom, () => togglePanel("bottom"), "⌘J")}
          {railBtn(<Search size={18} />, "Command palette", false, () => togglePalette("paletteOpen"), "⌘K")}
          <div className="mt-auto">
            {railBtn(<Maximize2 size={18} />, "Maximize viewport", maximized, toggleMaximized, "⇧F")}
          </div>
        </nav>

        {effectiveLeft && (
          <div className="vp-panel relative shrink-0 border-r" style={{ width: leftWidth }} role="complementary" aria-label="Layers">
            {leftPanel}
            {divider("left", "right-0 top-0 h-full w-[7px] cursor-col-resize")}
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          {children}
          {canvasOverlay}
        </div>
        {effectiveRight && (
          <div className="vp-panel relative shrink-0 border-l" style={{ width: rightWidth }} role="complementary" aria-label="Inspector">
            {rightPanel}
            {divider("right", "left-0 top-0 h-full w-[7px] cursor-col-resize")}
          </div>
        )}
      </div>
      {effectiveBottom && (
        <div className="vp-panel relative shrink-0 border-t" style={{ height: bottomHeight }} role="region" aria-label="Timeline and console">
          {divider("bottom", "left-0 top-0 h-[7px] w-full cursor-row-resize")}
          {bottomPanel}
        </div>
      )}
      {statusBar}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
