/** UI/workspace state: layout sizes, panel visibility, menus, theme.
 *  Persisted to localStorage (ADR-0003). */
import { create } from "zustand";

export type ThemeMode = "pro" | "presentation";
export type ColorMode = "dark" | "light";
export type TimelineMode = "compact" | "expanded";

export interface UiLayout {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
}
export interface UiPanels {
  left: boolean;
  right: boolean;
  bottom: boolean;
}

interface UiState {
  layout: UiLayout;
  panels: UiPanels;
  theme: ThemeMode;
  colorMode: ColorMode;
  maximized: boolean;
  timelineMode: TimelineMode;
  bottomTab: "timeline" | "console";
  menuOpen: string | null;
  setPanel: (k: keyof UiPanels, open: boolean) => void;
  togglePanel: (k: keyof UiPanels) => void;
  setLayout: (patch: Partial<UiLayout>) => void;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  setColorMode: (m: ColorMode) => void;
  toggleColorMode: () => void;
  setMaximized: (v: boolean) => void;
  toggleMaximized: () => void;
  setTimelineMode: (m: TimelineMode) => void;
  setBottomTab: (t: "timeline" | "console") => void;
  setMenuOpen: (m: string | null) => void;
}

const LS_KEY = "voxelpulse.ui.v1";
const DEFAULTS = {
  layout: { leftWidth: 240, rightWidth: 272, bottomHeight: 128 } as UiLayout,
  panels: { left: true, right: true, bottom: true } as UiPanels,
};

function load(): { layout: UiLayout; panels: UiPanels; timelineMode?: TimelineMode } {
  try {
    if (typeof localStorage === "undefined") throw new Error("no storage");
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<{
        layout: UiLayout; panels: UiPanels; timelineMode: TimelineMode;
      }>;
      return {
        layout: { ...DEFAULTS.layout, ...p.layout },
        panels: { ...DEFAULTS.panels, ...p.panels },
        timelineMode: p.timelineMode,
      };
    }
  } catch { /* corrupted prefs fall back to defaults */ }
  return { layout: { ...DEFAULTS.layout }, panels: { ...DEFAULTS.panels } };
}

function persist(s: UiState) {
  if (typeof localStorage === "undefined") return; // tests / SSR
  localStorage.setItem(LS_KEY, JSON.stringify({
    layout: s.layout, panels: s.panels, timelineMode: s.timelineMode,
  }));
}

const initial = load();

export const useUiStore = create<UiState>((set, get) => ({
  layout: initial.layout,
  panels: initial.panels,
  theme: "pro",
  colorMode: "dark",
  maximized: false,
  timelineMode: initial.timelineMode ?? "compact",
  bottomTab: "timeline",
  menuOpen: null,

  setPanel: (k, open) => {
    set((s) => ({ panels: { ...s.panels, [k]: open } }));
    persist(get());
  },
  togglePanel: (k) => {
    set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } }));
    persist(get());
  },
  setLayout: (patch) => {
    set((s) => ({ layout: { ...s.layout, ...patch } }));
    persist(get());
  },
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === "pro" ? "presentation" : "pro" })),
  setColorMode: (colorMode) => set({ colorMode }),
  toggleColorMode: () => set((s) => ({ colorMode: s.colorMode === "dark" ? "light" : "dark" })),
  setMaximized: (maximized) => set({ maximized }),
  toggleMaximized: () => set((s) => ({ maximized: !s.maximized })),
  setTimelineMode: (timelineMode) => set({ timelineMode }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));
