# Design Research — VoxelPulse v4 ("Spatial Glass")

Phase 0 research synthesis. Sources studied: Apple Human Interface Guidelines
(Design Principles, Layout, Typography, Foundations, Sidebars/Toolbars,
Progressive Disclosure), Google Material Design 3 (m3.material.io foundations,
structure, motion, accessibility; design.google), plus workflow patterns from
Foxglove Studio, Rerun, ArcGIS Pro, QGIS, CloudCompare, Blender, VS Code and
Potree (the latter two from prior v3 research). This document records the
principles we adopt — not links.

## What we learned and adopt

### 1. Clarity, deference, depth (Apple)
- **Clarity**: text legible at 10–12 px panel sizes; hierarchy through weight
  and color, not size alone. Numeric readouts always monospaced.
- **Deference**: *the 3D scene is the hero*. UI chrome recedes — near-opaque
  panels, 1 px hairline borders, no large glows in the analytical workspace.
  The current neon HUD becomes an optional **Presentation mode**.
- **Depth**: elevation communicates layering via subtle shadows on floating
  surfaces only (palette, menus, popovers); docked panels are flat.

### 2. Layout restraint (Apple HIG)
- No more than 2–3 primary controls side by side in a strip; glyph buttons
  limited and always paired with tooltips showing shortcuts.
- Panels keep generous padding rhythm (4 px base scale) and consistent
  section headers (11 px, uppercase, tracked, muted).

### 3. Progressive disclosure (Apple / VS Code)
- Default workspace is calm: layer tree, canvas, inspector, quiet status bar.
- Advanced render controls live in expandable sections; raw metadata and
  diagnostics appear only on request; timeline collapses fully for static
  datasets.

### 4. Structure and targets (Material 3)
- Minimum 24 px interactive targets; visible focus ring (2 px accent) on all
  controls; keyboard operability for every panel action.
- Status communicated by icon + text + color — never color alone.

### 5. Motion with meaning (Apple + M3)
- Micro-transitions 120–200 ms, standard easing; panels slide/resize without
  bounce. Motion communicates origin (palette drops from toolbar level),
  focus, and change. No decorative looping animation in the workspace
  (sweep/radar remains a scene element, toggleable). Respect
  `prefers-reduced-motion`.

### 6. Workstation patterns (ArcGIS/QGIS/Blender/VS Code/Foxglove/Rerun)
- **Menu bar**: conventional File/Edit/View/… categories breed familiarity and
  discoverability; items show shortcuts; nothing in menus that doesn't work.
- **Layer tree as source of truth**: visibility/opacity/lock per layer,
  right-click context menus, zoom-to-layer, rename/duplicate/remove.
- **Inspector is contextual** (point / feature / layer / detection): show only
  relevant fields.
- **Command palette as the power path**: fuzzy search across commands, layers,
  views (VS Code model). Every menu action is also a palette command.
- **Status bar, not telemetry cards**: `CRS | cursor XYZ | points | FPS |
  mode` in one quiet 24 px strip (ArcGIS model).
- **Resizing + persistence**: draggable dividers; layout survives reload via
  localStorage (VS Code model).

## What we deliberately reject

- Glassmorphism everywhere — translucency reserved for floating chrome.
- Neon/sci-fi as default identity — retained only in Presentation mode.
- Mobile-first flattening — this is desktop-class software (min ~1280×720).
- Whole-app monospace; emoji icons; decorative constant animation.

## Resulting token system (summary)

Surfaces: `canvas #07080B`, `panel #0E1014` (near-opaque), `overlay rgba(14,16,20,.85)`
(translucent, blur). Borders: hairline `rgba(255,255,255,.08)`. Text:
primary `#E6EAF0`, secondary `#9AA3B2`, muted `#5C6675`. Accent (restrained):
interactive `#4DA3FF` (blue), highlight/selection `#F59E0B` (amber), success
`#34D399`, warning `#F59E0B`, error `#F87171`. Motion: 140 ms ease-out
standard, 200 ms for panel slides. Focus: 2 px accent outline. Full tokens in
`frontend/src/theme.css` (CSS custom properties, consumed via Tailwind + components).
