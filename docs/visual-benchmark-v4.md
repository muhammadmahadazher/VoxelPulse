# Visual Benchmark — v4 Phase 1.5 (before → target)

Baseline captured from the running app (see `docs/assets/v4-before-1920.png`,
`v4-before-1280.png`, `v4-before-start.png`). This document is the failure
register for Phase 1 acceptance and the concrete fix plan for Phase 1.5.

## Current UI failures (observed in the screenshots)

| # | Failure | Why it harms usability | Fix |
|---|---|---|---|
| 1 | 10–11px typography dominates | Unreadable at working distance; reads as a toy | Type scale: 13px primary UI, 12px secondary, 12.5–13px semibold panel titles, 14px menus, status 12px; hierarchy via weight+size, not color alone |
| 2 | Near-black uniform surfaces (#07080B everywhere) | No depth; panels/canvas blur together; "black rectangles" | 5-level surface ramp (canvas → chrome → panel → raised → floating) with cool-graphite neutrals, luminance+border+shadow separation |
| 3 | Canvas framed like a web dashboard | Product feels like "dark React app", not a workstation | Two-row app header (menus + contextual toolbar), activity rail, architectural dock boundaries (square, not SaaS cards); canvas ~65–80% of area |
| 4 | Controls look like labels (text chips, thin glyph buttons) | Users can't infer clickability | 28–36px hit targets, 15–18px glyphs, rounded-square ToolButtons with idle/hover/active/pressed/disabled/focus states |
| 5 | Inspector is mostly dead black space | Wasted premium real estate | Contextual grouped sections with *editable* properties (colormap select, point-size stepper, opacity slider, EDL switch+strength), elegant empty state |
| 6 | Timeline is a raw `<input type=range>` | Reads as unfinished | Custom track with ticks, visible thumb, elapsed/total timecode, 28px transport buttons, speed segmented control, LIVE chip |
| 7 | Neon purple cloud + radar glow as default | Spectacle over analysis; hero screenshot unreadable | Default colormap = Height (viridis-family); Cyber becomes a preset; softer grid (major/minor fade), graphite depth gradient background |
| 8 | Layer rows are thin, states indistinct | Selection/hidden/locked not legible | 28px rows, type icons, hover-revealed actions, unmistakable selected row (accent wash + left indicator), grouped Scene/LiDAR/Perception sections |
| 9 | Status bar 24px mono soup | Diagnostics illegible | 26px grouped status: CRS · XYZ · selection — pts · FPS · mode chip, 12px readable |
| 10 | Start screen = centered modal vibe | Weak first impression | Welcome workspace: wordmark, tagline, 36px primary actions, examples as cards, recents; subtle dot-grid spatial motif |
| 11 | One-row 32px header with cramped menus | No application identity | Row 1: brand + menus + project/status; Row 2: spatial toolbar (nav tools, view segmented control, + Add Data primary, search) |
| 12 | 1280×720 collapses into microscopic labels | Unusable on laptops | Responsive density: tighter panel defaults, bottom collapsed initially, toolbar labels → icons below 1366px |
| 13 | 3D labels = arcade tags (glowing chips) | Breaks professional tone | 11px Inter labels, subtle dark chip w/ 1px border, no glow, distance-dimmed |
| 14 | No light theme; tokens not semantic | Token system unproven | `[data-theme="light"]` full override set; forces semantic naming |

## Reference patterns adopted (from research pass)

- **Apple HIG / Xcode / Final Cut**: two-row chrome, 13px+ UI text, menu rows 28–34px with right-aligned shortcuts, restrained single accent, depth via material steps not outlines.
- **Material 3**: ≥24px minimum targets (we use 28–36 for tools), visible focus, motion 100–200ms standard easing, state layers on hover.
- **Blender 4.x**: viewport dominance (~75%), Outliner row design (indent + type icon + hover actions), compact-but-readable density, draggable dock boundaries.
- **Figma**: canvas-first composition, inspector as grouped property sections, floating contextual controls only.
- **VS Code**: activity rail (icon-only, working destinations only), command palette grouping + fuzzy highlighting, quiet grouped status bar.
- **DaVinci Resolve**: timeline craftsmanship — ticks, timecode, transport, speed as first-class.

## Target personality

**Precise · Quiet · Technical · Premium · Spatial · Fast · Confident.**
Not cyberpunk, not gamer, not hacker-terminal, not generic SaaS.

## Point-cloud presets (data ≠ chrome)

`Height` (new analytical default, viridis-family) · `Intensity` (grayscale) ·
`Classification` (GIS semantic) · `Turbo` · `Viridis` · `Magma` · `Infrared` ·
`Zones` · `Cyber` (the previous neon identity, now a preset for presentation
mode / demos).
