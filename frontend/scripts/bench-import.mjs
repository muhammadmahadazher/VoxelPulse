#!/usr/bin/env node
/** Import-pipeline benchmark (§98). Reproducible, local-only — measures the
 *  REAL pipeline (source read → worker decode → chunk resource) through the
 *  app's own performance marks. Not a marketing number.
 *  Usage: node scripts/bench-import.mjs [baseUrl]   (default :5199) */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5199";
const SIZES = [100_000, 400_000];

function genXyz(n) {
  const lines = new Array(n);
  for (let i = 0; i < n; i++) {
    lines[i] = `${(i % 97) * 0.5} ${(i % 53) * 0.25} ${(i % 31) * 0.1} ${((i % 100) / 100).toFixed(3)}`;
  }
  return lines.join("\n");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + "/?project=1");
await page.waitForTimeout(3000);
await page.evaluate(() => { try { localStorage.clear(); } catch { /* noop */ } });

console.log("| points | file MB | decode ms | M pts/s |");
console.log("|---|---|---|---|");
for (const n of SIZES) {
  const xyz = genXyz(n);
  const mb = Buffer.byteLength(xyz) / 1e6;
  await page.locator("#vp-add-data").setInputFiles({
    name: `bench-${n}.xyz`, mimeType: "text/plain", buffer: Buffer.from(xyz),
  });
  await page.waitForFunction(
    (count) => document.body.innerText.includes(`${count.toLocaleString("en-US")}`) ||
               document.body.innerText.includes(`${Math.round(count / 1000)}k`),
    n, { timeout: 60_000 },
  );
  const marks = await page.evaluate(() => ({
    start: performance.getEntriesByName("vp:import:decode:start").pop()?.startTime ?? 0,
    end: performance.getEntriesByName("vp:import:decode:end").pop()?.startTime ?? 0,
  }));
  const ms = marks.end - marks.start;
  console.log(`| ${n.toLocaleString("en-US")} | ${mb.toFixed(1)} | ${ms.toFixed(0)} | ${(n / 1e6 / (ms / 1000)).toFixed(2)} |`);
  await page.evaluate(() => {
    performance.clearMarks("vp:import:decode:start");
    performance.clearMarks("vp:import:decode:end");
  });
  // remove the layer so the next iteration starts clean
  const layers = page.getByRole("complementary", { name: "Layers" });
  await layers.getByText(`bench-${n}.xyz`).click({ button: "right" });
  await page.getByRole("button", { name: "Remove Layer" }).click();
  await page.waitForTimeout(300);
}
await browser.close();
console.log("(local dev machine, headless Chromium, worker-decoded XYZ)");
