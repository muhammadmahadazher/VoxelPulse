# ADR 0003 — Scoped Zustand stores instead of one global store

Status: Accepted (2026-08-22) · Phase 1

## Context
`store.ts` currently mixes UI flags, layer toggles, telemetry frames,
timeline history and tool state in a single 200-line store. Every frame
update re-renders subscribers of unrelated slices; future project/undo state
would make this worse.

## Decision
Split into scoped stores with explicit ownership:
`uiStore` (layout, menus, palette, theme — persisted to localStorage),
`projectStore` (project meta, layers, selection, dirty flag, recents —
persisted via `.vxp` + localStorage), and the existing telemetry store
(frames, history, stats — ephemeral, unchanged). Cross-store reactions are
explicit subscriptions, not merged state. Big binary data stays out of stores
entirely (ADR-0002: renderer/engine owns buffers).

## Consequences
+ Re-render scopes match concerns; panel resize no longer touches the frame
  loop; persistence strategy per store is clear.
+ Undo/redo can later snapshot/patch `projectStore` command deltas.
− Slightly more imports; convention must prevent a new god-store.

## Alternatives rejected
Single store with slice selectors (still one dependency graph); Redux
(boilerplate disproportionate); Context (re-render hazard for high-frequency
data).
