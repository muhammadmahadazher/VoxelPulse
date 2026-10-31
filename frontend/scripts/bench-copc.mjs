#!/usr/bin/env node
/** Phase 4.5 gigabyte-scale COPC benchmark harness (§49).
 *
 * Usage: node scripts/bench-copc.mjs <copc-url> [label] [durationSec]
 * Requires the VoxelPulse dev server on :5199 (npm run dev).
 *
 * Records (§8, §49): source bytes, metadata ms, first-point ms, stable-view
 * ms, fetched bytes (network vs cache), range-request count, largest request,
 * resident/visible nodes, visible points, resource-manager report, and the
 * source-stat byte accounting. Emits machine-readable JSON + readable table.
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2];
const LABEL = process.argv[3] ?? URL?.split("/").pop() ?? "dataset";
const DURATION = Number(process.argv[4] ?? 45);

if (!URL) {
  console.error("usage: node scripts/bench-copc.mjs <copc-url> [label] [durationSec]");
  process.exit(1);
}

const b = await chromium.launch({ headless: false });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
p.on("console", (m) => {
  if (m.type() === "error" && !/WebSocket|ws:/.test(m.text())) errors.push(m.text().slice(0, 200));
});

await p.goto("http://localhost:5199/?project=1");
await p.waitForTimeout(2000);

const tOpen = Date.now();
p.once("dialog", (d) => void d.accept(URL));
await p.getByRole("menuitem", { name: "File" }).click();
await p.waitForTimeout(400);
await p.locator("button", { hasText: "Open URL" }).click();

// T1: first points visible
let firstPointMs = null;
while (Date.now() - tOpen < 120_000) {
  const s = await p.evaluate(() => {
    const rt = [...(window.__vpStreaming?.values() ?? [])][0];
    return rt ? { ready: rt.firstNodeReadyAt, meta: rt.openStartedAt } : null;
  });
  if (s?.ready) {
    firstPointMs = s.ready - s.meta;
    break;
  }
  await p.waitForTimeout(250);
}

// T2: first stable coarse view — no fetches in flight + visible points present
let stableMs = null;
const tStableStart = Date.now();
while (Date.now() - tStableStart < 120_000) {
  const s = await p.evaluate(() => {
    const rt = [...(window.__vpStreaming?.values() ?? [])][0];
    return rt ? { fetching: rt.metricsReadonly.fetching, visiblePoints: rt.metricsReadonly.visiblePoints, open: rt.openStartedAt } : null;
  });
  if (s && s.fetching === 0 && s.visiblePoints > 0 && Date.now() - tStableStart > 3000) {
    stableMs = Date.now() - tOpen;
    break;
  }
  await p.waitForTimeout(500);
}

// T3: idle refinement for DURATION seconds — sample memory/metrics every 5 s
const samples = [];
const tSample = Date.now();
while (Date.now() - tSample < DURATION * 1000) {
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => ({
    t: Date.now(),
    nodes: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.cacheNodes; })(),
    visibleNodes: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.visibleNodes; })(),
    visiblePoints: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.visiblePoints; })(),
    bytesFetched: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.bytesFetched; })(),
    rangeRequests: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.rangeRequests; })(),
    preparedBytes: (() => { const rt = [...(window.__vpStreaming?.values() ?? [])][0]; return rt.metricsReadonly.preparedBytes; })(),
    jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  }));
  samples.push(s);
}

// final accounting
const final = await p.evaluate(() => {
  const rt = [...(window.__vpStreaming?.values() ?? [])][0];
  const stats = window.__vpSourceStats ?? null;
  return {
    metrics: rt.metricsReadonly,
    openStartedAt: rt.openStartedAt,
    firstNodeReadyAt: rt.firstNodeReadyAt,
    source: stats ? { ...stats } : null,
    meta: document.body.innerText.match(/COPC[^\n]*/)?.[0] ?? "",
  };
});

const sourceBytes = final.source ? null : null;
const result = {
  label: LABEL,
  url: URL,
  totalSourceBytes: final.source ? null : "server-side unknown (remote)",
  firstPointMs,
  firstStableViewMs: stableMs,
  bytesFromNetwork: final.source?.bytesFromNetwork ?? null,
  bytesFromCache: final.source?.bytesFromCache ?? null,
  nodePayloadBytes: final.metrics.bytesFetched,
  rangeRequests: final.metrics.rangeRequests,
  largestRequest: final.source?.largestRequest ?? null,
  cacheHits: final.source?.cacheHits ?? null,
  cacheMisses: final.source?.cacheMisses ?? null,
  requestsStarted: final.source?.requestsStarted ?? null,
  requestsCompleted: final.source?.requestsCompleted ?? null,
  requestsAborted: final.source?.requestsAborted ?? null,
  residentNodes: final.metrics.cacheNodes,
  visibleNodes: final.metrics.visibleNodes,
  visiblePoints: final.metrics.visiblePoints,
  preparedBytes: final.metrics.preparedBytes,
  jsHeapSamplesMB: samples.map((s) => s.jsHeapMB).filter((v) => v !== null),
  samples,
  errors,
};
console.log("=== BENCH RESULT (JSON) ===");
console.log(JSON.stringify(result, null, 1));
console.log("=== SUMMARY ===");
console.log(`first points: ${firstPointMs ?? ">120s"} ms`);
console.log(`network bytes: ${result.bytesFromNetwork ?? "?"} | cache bytes: ${result.bytesFromCache ?? "?"}`);
console.log(`range requests: ${result.rangeRequests} | largest: ${result.largestRequest ?? "?"}`);
console.log(`resident nodes: ${result.residentNodes} | visible: ${result.visibleNodes} | visible pts: ${result.visiblePoints}`);
if (result.jsHeapSamplesMB.length) {
  console.log(`JS heap MB: first=${result.jsHeapSamplesMB[0]} last=${result.jsHeapSamplesMB[result.jsHeapSamplesMB.length - 1]} peak=${Math.max(...result.jsHeapSamplesMB)}`);
}
if (errors.length) console.log(`ERRORS: ${errors.slice(0, 5).join(" | ")}`);
const fs = await import("node:fs");
fs.writeFileSync(`C:/Users/mahad/AppData/Local/Temp/bench-${LABEL.replace(/\W+/g, "_")}.json`, JSON.stringify(result, null, 2));
await b.close();
