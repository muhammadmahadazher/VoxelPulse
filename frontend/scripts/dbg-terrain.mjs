/** Debug: terrain toggle → 3D mesh + numerical checks. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures"].map((r) => join(process.cwd(), r)).find((d) => existsSync(join(d, "dem-f32.tif")));
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto("http://localhost:5173/?project=1");
await page.waitForTimeout(1500);
await page.setInputFiles("#vp-add-data", join(FIX, "dem-f32.tif"));
await page.waitForTimeout(4000);

// switch layout back to 3D? map auto-focus happened; terrain lives in the 3D panel (left half) — press V to cycle layouts
// enable terrain via Inspector switch
const sw = page.getByText("3D terrain").locator("..").locator("button, [role=switch]");
const cnt = await sw.count();
console.log("terrain switch candidates:", cnt);
if (cnt) { await sw.first().click(); }

await page.waitForTimeout(5000);
const state = await page.evaluate(() => {
  const rts = [...(window).__vpRasters.values()];
  const rt = rts[0];
  const stats = rt?.stretchStats;
  return { nRasters: rts.length, stats };
});
console.log("state:", JSON.stringify(state));
await page.screenshot({ path: "scripts/dbg-terrain.png" });
await browser.close();
