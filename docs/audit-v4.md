# VoxelPulse v4 Audit (Phase 0)

Date: 2026-08-22 · Scope: full repository, renderer, state, parsers, backend, CI, deployment.

**Current state:** ~2,800 lines of frontend TypeScript across 25 files, a FastAPI
telemetry backend, GitHub Actions CI + Pages deploy. Production build is clean
(strict `tsc`), both workflows green, live app verified rendering in-browser
(sim engine, EDL, split/fusion viewports).

## KEEP

- **Telemetry pipeline** (`ws.ts`, `sim/simWorker.ts`) — clean binary `VPF1`
  protocol, WebWorker standalone engine with transparent failover; proven at
  25k pts / 30 FPS live and on static hosting.
- **Renderer core** (`scene/Viewport.tsx`, `shaders.ts`, `edl.ts`) — single
  reused GPU buffer, zero React re-renders in the frame loop, in-shader
  intensity/ROI rejection, EDL depth pass, 8 colormaps. This is the product's
  signature technology and must not be regressed.
- **Parsers/exporters** (`utils/fileParse.ts`, `exporters.ts`) — working
  LAS/PLY/PCD/XYZ import; PLY/PCD/4K-PNG export.
- **Scene visuals** — ego frame, holographic boxes, crop gizmo, ruler with
  slope. Functionally sound.
- **CI/CD + Pages deployment** — working, fast (~1 min), correct base-path
  handling.
- **Backend** — compact, testable, smoke-tested in CI.

## REFACTOR

- **One giant Zustand store** (`store.ts`, 200+ lines) mixes UI state, layer
  visibility, telemetry frames, timeline history and tool state. Needs scoped
  stores (ui / project / telemetry) per the v4 state architecture.
- **Floating-overlay UI** (`ui/Studio*.tsx`, `HudBar.tsx`) — panels are
  absolutely-positioned overlays, not a real workspace: no resizing, no menu
  system, high visual noise (large telemetry chips instead of a quiet status
  bar). Restyle + restructure into a docked shell.
- **Command palette** — flat command list with substring filter; needs fuzzy
  search, layer/command mixing, project commands.
- **Timeline** — functional replay, but always visible and visually loud.

## REPLACE

- **Ad-hoc "layers"** — `showGround/showBoxes/...` booleans are not a layer
  model. Replace with a real `Layer` registry (id, type, visibility, opacity,
  metadata, styling) owned by project state.
- **No project concept** — nothing persists between sessions except URL
  params. Introduce a versioned `.vxp` project file (JSON, references only).
- **Demo-first boot** — the app always launches a simulated stream; real data
  import hides behind drag & drop. Replace with a start screen + explicit
  demo/example loading.

## ADD

- Application menu bar, resizable/collapsible docked panels, status bar.
- `SpatialReference` + `Dataset`/`FormatAdapter` abstractions (Phase 2).
- Worker pool, resource manager, project serialization, unit tests (Vitest),
  docs site content, ADRs (started in `docs/adr/`).

## Known technical debt

1. **Local development workaround (not repository architecture)**: `npm install`
   fails with `EBADF` on the mounted Google Drive workspace. Local Z Code /
   Windows setups can work around it with an NTFS junction
   (`C:\vp-fe\src` → `frontend/src`, `resolve.preserveSymlinks` in the local
   vite config). This is a developer-environment fix only — the canonical
   source remains `frontend/src`, and CI / normal contributors never touch
   `C:\vp-fe` (`npm install && npm run dev` in `frontend/` is the supported
   flow).
2. `three-stdlib` peer types used for OrbitControls typing (drei dependency).
3. Test coverage: Vitest unit suites plus Playwright interaction and
   visual-regression suites (see `frontend/tests/`); deeper coverage for the
   Phase 2+ analysis tools.
4. Bundle ~1.25 MB (gzip ~350 KB) — acceptable now; code-splitting planned
   with GIS modules (Phase 5+).
