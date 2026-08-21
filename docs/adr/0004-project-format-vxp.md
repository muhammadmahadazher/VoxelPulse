# ADR 0004 — Versioned `.vxp` project format (JSON, references-only)

Status: Accepted (2026-08-22) · Phase 1 (minimal), Phase 3 (full)

## Context
Nothing persists today beyond URL params. A serious workstation needs save,
load, sharing and recovery without duplicating multi-GB source datasets, and
must work in the browser sandbox (no arbitrary local writes).

## Decision
`.vxp` is a versioned JSON document describing *references and state*: project
metadata, CRS, workspaces (cameras, visible layers, visualization params),
layer hierarchy with `DataSource` references, layout state, saved views. It
never embeds point data. Phase 1 implements: format v1, New/Open/Save/Save As
(download), recent projects + autosave in localStorage, layout persistence.
Phase 3 adds recovery, workspace tabs serialization and annotations. File
layers rehydrate by re-picking the file; stream/demo layers reattach live.

## Consequences
+ Tiny files, human-readable diffs, forward migration via `formatVersion`.
+ Works identically in browser and a future desktop shell.
− Cannot fully restore file-backed layers without user re-selection
  (browser sandbox limitation, surfaced honestly in the UI).

## Alternatives rejected
ZIP archive bundling data (huge files, false expectation); server-side
projects only (breaks no-backend promise); localStorage-only (invisible,
non-shareable).
