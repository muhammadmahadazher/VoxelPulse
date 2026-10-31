/** CP11: real CPU/iGPU measurements for the completion report.
 *  Import → first-pixel latency, interaction FPS, JS heap, byte accounting. */
import { chromium } from "@playwright/test";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures"].map((r) => join(process.cwd(), r)).find((d) => existsSync(join(d, "dem-f32.tif")));
const COG = readFileSync(join(FIX, "cog-rgb-ov.tif"));

// local COG range server
const ranges = [];
const server = http.createServer((req, res) => {
  const cors = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };
  const r = req.headers.range;
  if (req.method === "HEAD") { res.writeHead(200, { ...cors, "content-length": String(COG.length) }); res.end(); return; }
  if (r) {
    const m = /bytes=(\d+)-(\d+)/.exec(r);
    ranges.push(+m[1]);
    const s = +m[1], e = Math.min(+m[2], COG.length - 1);
    res.writeHead(206, { ...cors, "content-range": `bytes ${s}-${e}/${COG.length}`, "content-length": String(e - s + 1) });
    res.end(COG.subarray(s, e + 1));
  } else {
    res.writeHead(200, { ...cors, "content-length": String(COG.length) });
    res.end(COG);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:5173/?project=1");
await page.waitForTimeout(1500);

// 1. local raster import → first probeable pixel
const t0 = Date.now();
await page.setInputFiles("#vp-add-data", join(FIX, "rgb.tif"));
let firstPixel = null;
for (let i = 0; i < 60; i++) {
  await page.mouse.click(830, 320);
  await page.waitForTimeout(300);
  const probe = await page.evaluate(() => document.body.innerText.match(/px \d+,\d+ · EPSG:\d+/)?.[0] ?? null);
  if (probe) { firstPixel = Date.now() - t0; break; }
}
console.log("import→first probeable pixel:", firstPixel, "ms");

// 2. interaction FPS over 5 s of pan/zoom on the map
await page.mouse.move(830, 320);
const t1 = Date.now();
let frames = 0;
const count = await page.evaluate(() => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else resolve(n); };
  requestAnimationFrame(tick);
}));
const fps = count / ((Date.now() - t1) / 1000);
console.log("map interaction FPS (5s window):", fps.toFixed(1), "→", count, "frames");

// 3. JS heap
const heap = await page.evaluate(() => {
  const mem = performance;
  return mem && mem.memory ? mem.memory.usedJSHeapSize : null;
});
console.log("JS heap used:", heap ? (heap / 1e6).toFixed(1) + " MB" : "unavailable (Chromium metric)");

// 4. COG remote: bytes for initial view
await page.evaluate(async (u) => { await fetch(u + "/reset"); }, `http://127.0.0.1:${port}`).catch(() => {});
page.once("dialog", (d) => void d.accept(`http://127.0.0.1:${port}/cog-rgb-ov.tif`));
await page.getByRole("menuitem", { name: "File" }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: "Open URL" }).click();
await page.waitForTimeout(8000);
const cogBytes = await page.evaluate(() => {
  const rt = [...(window).__vpRasters.values()].find((r) => r.rasterDescriptor.width === 32);
  return rt ? rt.metricsReadonly().fetchedBytes : null;
});
console.log("COG initial view: ranges:", ranges.length, "fetchedBytes:", cogBytes, "of", COG.length, "file");

await browser.close();
server.close();
