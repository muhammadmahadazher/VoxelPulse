# Development workflow (source-tree policy)

## Where development happens

All development happens in **`C:\VoxelPulse`** — a plain Git working tree
on the native C: filesystem, cloned from
`https://github.com/muhammadmahadazher/VoxelPulse`.

- GitHub `origin/main` is the single source of truth for syncing between
  machines and sessions.
- The Google Drive copy (`J:\My Drive\Zcode_Projects\VoxelPulse`) is a
  **frozen backup**. It carries a `DEVELOPMENT-MOVED.md` marker at its
  root; do not edit source there. Drive sync lag caused stale Vite
  transforms, edits appearing and disappearing, and CI consuming
  different sources than the editor.
- The former `C:\vp-fe` NTFS-junction mirror is **retired**: the
  junction link (`C:\vp-fe\src` → Drive) was removed with `rmdir` (link
  only; junction targets are never touched by removing a reparse point).
  Junctions are not a supported project architecture.

## Acceptance evidence (2026-10-31)

After `git clone` at `cbac85d`, with the same source file edited once:

1. `npx tsc -b --noEmit` → clean.
2. `npx vitest run` → 193/193 passed.
3. Vite dev server: `curl http://localhost:5199/src/scene/MapWorkspace.tsx`
   returned the transformed module **including the edit marker**.
4. `npx vite build`: `grep -l "VPWF-CHECK-1739" dist/assets/*.js`
   matched the production bundle **including the same edit marker**.

Editor, dev server, tests, and production build all consume one source
version. `npm ci` on the native tree installs in ~26 s with no errors
(the old Drive-mounted tree failed with EBADF).

## Rules

- **One editable tree**: `C:\VoxelPulse`. Never re-introduce junctions
  or parallel trees.
- Run everything from `C:\VoxelPulse\frontend`:
  `npm run dev`, `npm test`, `npm run lint`, `npm run build`,
  `npm run test:visual`.
- Commit early, push to GitHub so the other copy can be refreshed by
  `git -C "J:\...\VoxelPulse" pull` (backup refresh is optional and
  manual).
- Lock-file cleanup (`HEAD.lock`, `packed-refs.lock`) is no longer
  needed here — that failure mode was caused by the Drive mount.
- Note: a system HTTP proxy intercepts `127.0.0.1` traffic on this
  machine; when probing a dev server with curl use `--noproxy "*"`.
