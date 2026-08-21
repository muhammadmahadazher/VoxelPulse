import { useCallback, useRef, type ReactNode } from "react";

/** Resizable workspace shell: menu top, docked panels around the canvas,
 *  status bar bottom. Dividers drag via pointer events; sizes live in uiStore. */
export function Shell({
  menuBar, leftPanel, rightPanel, bottomPanel, statusBar, children,
  leftWidth, rightWidth, bottomHeight,
  leftOpen, rightOpen, bottomOpen,
  onResize, canvasOverlay,
}: {
  menuBar: ReactNode;
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

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
    if (drag.current === "left") onResize({ leftWidth: clamp(e.clientX, 180, 420) });
    if (drag.current === "right") onResize({ rightWidth: clamp(window.innerWidth - e.clientX, 220, 460) });
    if (drag.current === "bottom") onResize({ bottomHeight: clamp(window.innerHeight - e.clientY - 24, 96, 420) });
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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--vp-canvas)] text-[var(--vp-text-1)]">
      {menuBar}
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <div className="vp-panel relative shrink-0 border-r" style={{ width: leftWidth }} role="complementary" aria-label="Layers">
            {leftPanel}
            <div onPointerDown={start("left")}
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--vp-accent)]/40" />
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          {children}
          {canvasOverlay}
        </div>
        {rightOpen && (
          <div className="vp-panel relative shrink-0 border-l" style={{ width: rightWidth }} role="complementary" aria-label="Inspector">
            {rightPanel}
            <div onPointerDown={start("right")}
              className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--vp-accent)]/40" />
          </div>
        )}
      </div>
      {bottomOpen && (
        <div className="vp-panel relative shrink-0 border-t" style={{ height: bottomHeight }} role="region" aria-label="Timeline and console">
          <div onPointerDown={start("bottom")}
            className="absolute left-0 top-0 h-1 w-full cursor-row-resize hover:bg-[var(--vp-accent)]/40" />
          {bottomPanel}
        </div>
      )}
      {statusBar}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
