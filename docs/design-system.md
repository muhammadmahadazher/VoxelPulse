# VoxelPulse Design System — "Spatial Glass" v2

Phase 1.5 component system. Tokens live in `frontend/src/theme.css`;
primitives in `frontend/src/ui/kit.tsx`. This is the usage contract.

## Surfaces (5 levels)

| Token / class | Use | Not for |
|---|---|---|
| `--vp-canvas` | 3D scene backdrop only | UI panels |
| `--vp-chrome` / `.vp-chrome` | Header, activity rail, status bar | content panels |
| `--vp-panel` / `.vp-panel` | Docked panels (layers, inspector, timeline) | floating chrome |
| `--vp-raised` / `.vp-raised` | Inputs, steppers, segmented thumb | large surfaces |
| `--vp-floating` / `.vp-floating` | Menus, palette, tooltips, popovers (blur + shadow) | docked panels |

Rule: translucency only on *floating* chrome; docked panels stay opaque.

## Typography

| Role | Size / weight |
|---|---|
| Hero (start screen) | 34px semibold, tracking-tight |
| Panel titles | 12.5px semibold (`.PanelHeader`) |
| Primary UI | 13px |
| Secondary UI / metadata | 12–12.5px |
| Status bar | 11.5px mono |
| Section headers | 11px semibold, uppercase, +0.14em tracking |

Mono (`--vp-font-mono`) is reserved for coordinates, IDs, timecode, logs —
never body text. Hierarchy comes from size+weight first, color second.

## Controls (kit.tsx)

- **Button** — primary (accent fill, 36px lg for start screen), secondary
  (raised), ghost. Min height 24/28/32/36 (sm/md/lg/xl).
- **ToolButton** — 28px hit target, 16px glyph, `active` = accent wash;
  labels hide below 1280px (`hidden xl:inline`).
- **IconButton** — 24/28px square, hover state required.
- **Segmented** — view/layout switcher; active segment lifts (panel bg + shadow).
- **Switch** — 28×16px, label on the left; property toggles.
- **Slider** — visible 14px thumb, accent fill to value, numeric readout.
- **Stepper** — −/value/+ numeric field for point size etc.
- **PropertyRow** — 30px min height, label left / control right.
- **PanelHeader / Section** — 34px header bar; collapsible sections (120–150ms).
- **Chip** — semantic only: LIVE (success), DEMO DATA (warning), TRK-xxxx (accent).
- **EmptyState** — icon tile + title + one-line hint; never a black void.
- **Tooltip** — 500ms delay, shows shortcut; wraps every icon-only control.

## States

Hover = `--vp-hover` wash + text-1. Selected = `--vp-selected` wash + 2.5px
accent indicator (layer rows). Focus-visible = 2px accent ring (`.vp-focusable`).
Disabled = 35–40% opacity + pointer-events none. Danger = `--vp-error` text.

## Motion

90/150/220ms, cubic-bezier(0.25,0.46,0.45,0.94). Panels collapse with height
fade; palette drops 12px; menus fade 120ms. No springs, no loops.
`prefers-reduced-motion` zeroes all durations.

## Layout constants

Rail 46px · header rows 34+40px · status 26px · menu rows 30px min ·
layers 200–420px · inspector 240–460px · bottom 120–420px. Dividers: 7px
hitbox, visible on hover only.

## Color semantics

One primary accent (`--vp-accent` blue). Success/live green, warning/demo
amber, error red — used only for meaning. GIS/data palettes are independent
of chrome. Light theme swaps every token via `[data-theme="light"]` — never
hand-pick light values in components.

## Accessibility contract

Every control keyboard-reachable; visible focus ring; ≥24px targets (tools
28–36px); status never color-only (LIVE chip includes text); switches/inputs
carry aria labels; sliders/scrubber are `role=slider` with aria-valuenow.
