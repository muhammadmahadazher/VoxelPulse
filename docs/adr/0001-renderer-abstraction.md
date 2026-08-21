# ADR 0001 — Renderer abstraction over Three.js/R3F

Status: Accepted (2026-08-22) · Phase 1

## Context
Today's viewport is a React Three Fiber canvas with custom GLSL point
shaders, an EDL post pass and drei helpers. The v4 vision requires multiple
workspaces (scene/map/globe/fusion), potential WebGPU adoption, and possibly
a globe engine — the app must not hard-couple to R3F internals.

## Decision
Introduce a narrow adapter seam owned by `scene/`:
`RenderEngine` (capability detection: WebGL2/WebGPU, texture limits),
`ViewportHandle` (camera presets, focus, screenshot), and render *layers*
that register with the engine rather than mounting ad-hoc JSX from UI code.
UI components never import Three.js. The existing R3F implementation becomes
the first adapter; WebGPU arrives later as a parallel adapter behind
capability detection with automatic WebGL2 fallback.

## Consequences
+ Renderer work is isolated; swapping/adding engines (globe, WebGPU) does not
  touch UI or state.
+ Existing proven code is preserved, not rewritten.
− Slight indirection cost; adapters must stay disciplined (no leaking of
  Three types through the seam).

## Alternatives rejected
Direct R3F everywhere (fastest today, walls us in); full custom engine
(unnecessary risk); CesiumJS as the primary engine now (huge dependency,
conflicting render loop — revisit for the Globe workspace in Phase 6).
