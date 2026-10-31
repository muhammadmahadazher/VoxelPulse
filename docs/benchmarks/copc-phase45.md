# COPC Scale Validation — Phase 4.5

Measured on the current CPU + integrated-graphics development machine
(§4, §117). No discrete GPU; all numbers from the acceptance environment
via `frontend/scripts/bench-copc.mjs` (drives the real Open URL flow).

## Environment

| | |
|---|---|
| CPU | AMD Ryzen 7 7730U (8C/16T) |
| Graphics | AMD Radeon integrated (no discrete GPU) |
| RAM | 16 GB |
| OS | Windows 11 (build 26200) |
| Browser | Chromium (Playwright headed) |
| Viewport | 1600×900, DPR 1 |
| Perf mode | Balanced (1.5 M point budget) |
| EDL | on (default) |

## Scale validation (§67 table)

| Dataset | Size | First points | Bytes fetched (network) | Fraction | Range reqs | Visible nodes | Visible points | Heap peak |
|---|---|---|---|---|---|---|---|---|
| Autzen | 77 MB | 1.9 s | 6.33 MB | 7.8% | 17 | 11 | 411,690 | 305 MB |
| Millsite | 1.35 GB | 3.4 s | 4.82 MB | 0.33% | 20 | 15 | 275,995 | 314 MB |
| SoFi | 1.90 GB | 4.1 s | 5.77 MB | 0.30% | 21 | 16 | 331,847 | 693 MB |

- "Bytes fetched" = GET response bodies over the network, measured in-app
  via `urlSourceStats` (§9: network and cache bytes counted separately;
  cache hits were 0 — each node range is fetched once).
- Aborted requests: 0. Failed requests: 0. No full-file GET on any dataset
  (also asserted by the Playwright suite against the local range server).
- No tab crash, no worker growth, no refinement loop on any dataset.
- "Fraction" = network bytes ÷ full source size. The §2 criterion —
  requested bytes ≪ source size — holds with an order of magnitude to spare
  on the gigabyte datasets.

## Memory soak (§15–17)

7-minute idle observation on SoFi (1.9 GB) after initial load, sampling
every 5 s. Camera static; scheduler idle short-circuit active (§20).

- JS heap: fluctuates in a **bounded band (≈130–690 MB)** across the whole
  soak — oscillating with GC cycles, **not rising forever**. First sample
  137 MB, final 556 MB, peak 693 MB.
- Streaming network activity during the soak: **zero bytes** (all node
  ranges were already fetched; range-request count constant at 21).
- Visible points: constant at 331,847 — the scheduler is fully quiescent.
- The demo scene (which runs concurrently in these tests) contributes its
  own per-frame allocation churn to the heap band.
- laz-perf WASM: 1000 decode/dispose cycles show bounded heap (unit test,
  `hardening.test.ts`) — retained reusable heap, no monotonic growth.

## Bottleneck (§35)

At gigabyte scale the bottleneck is **network latency for node ranges**
(each range is a round trip to S3; decode is sub-millisecond per node on
this CPU). The scheduler correctly overlaps fetches; nothing on the main
thread stalled during any run.

## Fixes made during this phase

1. §11–12: hierarchy-page discovery is a state machine (bounded retries +
   backoff) — page spam and failure storms eliminated.
2. §27–29: camera-fit point sizing (per-node spacing attribute) — frame-all
   views show shape instead of 1px dust.
3. §9–10: exact byte accounting in UrlSource (network vs cache, aborts,
   largest request) exposed for the harness.
4. §116: the whole-file size guard now applies only to whole-file decode —
   the 800 MB gate was blocking the gigabyte COPC imports.
5. §20/§66: scheduler idle short-circuit — static camera + no pending work
   skips traversal entirely (idle CPU → ~zero; SoFi heap peak 955 → 494 MB
   in the first A/B comparison, and the long soak confirms a bounded band).
6. §93: WKT CRS failures degrade to UNKNOWN instead of failing the import;
   EPSG authority extraction takes the CRS-level (last) AUTHORITY clause.

## CI (§52–55)

`.github/workflows/copc-acceptance.yml` — daily schedule + manual dispatch;
runs unit tests, the three COPC acceptance tests (streaming without full
download, camera-driven refinement, removal cleanup — all network-free via
the local range server), and the interaction regression suite.
