# Adding a Format Adapter

This guide walks through adding a new point-cloud format to VoxelPulse. The
XYZ adapter (`frontend/src/core/data/formats/xyz.ts`) is the reference
implementation — copy its shape (§103–104).

## The 6 steps

1. **Write a pure parser** in `formats/parsers/<format>.ts`.
   - Signature: `(buffer: ArrayBuffer, opts?) => { pointCount, positions: Float32Array, intensity?, colors?, classification? }`.
   - It must not touch the DOM, `fetch`, or app state — it runs inside a Web Worker.
   - Validate hostile input: counts, offsets, strides, `pointCount × stride`
     against the real buffer length. Throw `VpDataError` with a code
     (`"invalid-data"`, `"unsupported-format"`) and a **user-facing message**
     plus a technical `detail` (§112–113, §32).
   - Enforce an allocation guard (`MAX_*_POINTS`) before allocating.

2. **Write the adapter** in `formats/<format>.ts`.
   - Single-chunk formats: build on `makeSingleChunkAdapter({ id, label, probe,
     inspectInfo, decode })` — see `las.ts`/`ply.ts`/`pcd.ts`.
   - `probe(ctx)` returns a confidence 0–1. Read magic bytes from
     `ctx.header`; use `ctx.filename`/`ctx.mime` only as hints (≤ +0.1).
     Content decides; a correct extension with wrong content must NOT be
     accepted (§11, §57).
   - `inspectInfo(source)` reads the *smallest header that answers metadata*
     via `source.read({ offset, length }, signal)` — partial reads are the
     architecture's point (§66). Return `DatasetMetadata` (pointCount, bounds
     if the format stores them, `fields`, and format-specific facts under
     `formatSpecific.<format>`).
   - `decode(buffer)` calls your parser.

3. **Register** the adapter in `formats/index.ts` (`registerBuiltinAdapters`).

4. **Declare capabilities** in `formats/capabilities.ts` — one factual row:
   `browserImport`, `randomAccess`, `streaming`, `export`, `notes`. The README
   table derives from this (§88, §102).

5. **Add fixtures**: extend `scripts/gen-fixtures.mjs` (deterministic, byte-
   stable) and commit the small outputs under `tests/fixtures/`. Malformed
   variants are derived in tests by truncating/corrupting buffers — do not
   commit broken files (§56).

6. **Test the §57 matrix** — add your format to `formats/formats.test.ts`:
   valid open · truncated body · corrupted header · wrong-extension detection ·
   right-extension/wrong-content refusal · cancellation. Then add the file to
   the cross-detection list and the `integration.test.ts` pipeline list.

## Contracts to keep

- The renderer never learns about your format: it consumes `DecodedChunk`
  arrays via `chunkToFrame` (`utils/frameBridge.ts`) (§38).
- Adapters never touch React/Zustand; `importService` owns stage reporting
  and cancellation (§50, §31).
- If your format needs more than one chunk, return the real `chunkCount` and
  implement `readChunk(index)` — the manager already routes per-chunk (§40–42).
- If your format is compressed (LAZ-like), enforce decompression limits or
  reject with `"unsupported-format"` until limits exist (§114).

## UI copy rules

Structured errors surface verbatim: write messages a user can act on —
> "This PCD uses binary_compressed encoding, which is not supported."
never `TypeError: undefined is not iterable` (§33, §90).
