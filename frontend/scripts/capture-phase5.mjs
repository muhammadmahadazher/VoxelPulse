/** CP12: capture the mandatory Phase 5 visual states (§12) at 1280×720.
 *  Run against a dev server: node scripts/capture-phase5.mjs */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures"].map((r) => join(process.cwd(), r)).find((d) => existsSync(join(d, "dem-f32.tif")));
const OUT = join(process.cwd(), "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto("http://localhost:5173/?project=1");
await page.waitForTimeout(1500);

// state 2: single-band elevation (grayscale default → the map shows it)
await page.setInputFiles("#vp-add-data", join(FIX, "dem-f32.tif"));
await page.waitForTimeout(4500);
await page.locator("select").first().selectOption("pseudocolor");
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, "p5-2-elevation-pseudocolor.png") });
console.log("2/7 elevation pseudocolor");

// state 3: real 3D terrain
await page.getByText("3D terrain").locator("..").locator("button, [role=switch]").first().click();
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, "p5-3-terrain.png") });
console.log("3/7 terrain");

// import the matched ortho → drape on the terrain
await page.setInputFiles("#vp-add-data", join(FIX, "ortho.tif"));
await page.waitForTimeout(4500);
// select the DEM layer (the ortho import re-selected the ortho layer)
await page.getByRole("complementary", { name: "Layers" }).getByText("dem-f32.tif").first().click();
await page.waitForTimeout(500);
const drapeSel = page.locator("select").nth(1);
await drapeSel.selectOption({ label: "ortho.tif" });
await page.waitForTimeout(6000);

// state 1: RGB orthophoto in Map (both rasters render; ortho = RGB)
await page.screenshot({ path: join(OUT, "p5-1-rgb-map.png") });
console.log("1/7 rgb map");

// state 4: imagery draped on terrain
await page.evaluate(() => {
  const d = (window).__vp3d ?? {};
  if (d.controls) { d.controls.target.set(160, 160, 220); d.camera.position.set(160, -140, 330); d.controls.update(); }
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "p5-4-drape.png") });
console.log("4/7 drape");

// state 7: multiple raster layers (DEM + ortho in Layers + map)
await page.screenshot({ path: join(OUT, "p5-7-multi-raster.png") });
console.log("7/7 multi raster");

// state 5: LiDAR + terrain in one scene
await page.setInputFiles("#vp-add-data", join(FIX, "fusion.las"));
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const d = (window).__vp3d ?? {};
  if (d.controls) { d.controls.target.set(160, 160, 230); d.camera.position.set(-60, -60, 400); d.controls.update(); }
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "p5-5-fusion.png") });
console.log("5/7 fusion");

// state 6: raster Inspector selected
await page.getByRole("complementary", { name: "Layers" }).getByText("dem-f32.tif").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "p5-6-inspector.png") });
console.log("6/7 inspector");

await browser.close();
console.log("captured to", OUT);
