/** CP4 acceptance — GeoTIFF import → Map workspace → visible pixels, through
 *  the real UI (Add Data file input). Asserts layer registration, layout
 *  focus, framing, pixel probing, visibility and resource disposal. */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures", "../../tests/fixtures"]
  .map((rel) => join(process.cwd(), rel))
  .find((dir) => existsSync(join(dir, "rgb.tif")))!;

async function importRaster(page: Page, fixture: string): Promise<void> {
  await page.goto("/?project=1");
  await page.waitForTimeout(1200);
  await page.setInputFiles("#vp-add-data", join(FIX, fixture));
}

function runtimes(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __vpRasters?: Map<string, unknown> }).__vpRasters?.size ?? -1);
}

async function probeText(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.body.innerText.match(/px \d+,\d+ · EPSG:\d+[^\n]*/)?.[0] ?? null);
}

test.describe("raster import acceptance (CP4)", () => {
  test("RGB GeoTIFF imports, focuses the Map, and renders probeable pixels", async ({ page }) => {
    await importRaster(page, "rgb.tif");

    // runtime attached (poll — attach is async)
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);

    // Map workspace focused: layout label visible
    await expect(page.getByText("2D MAP · NORTH-UP")).toBeVisible();

    // Inspector shows raster facts (import auto-selects the layer)
    await expect(page.getByText("Sample type").first()).toBeVisible();
    await expect(page.getByText("uint8").first()).toBeVisible();

    // pixel probe through the real canvas: click the map panel center and
    // poll — the tile must be resident and raycast-hit for a probe result
    await expect.poll(async () => {
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      return probeText(page);
    }, { timeout: 20_000 }).toMatch(/px 3\d,\d/); // center ≈ col 32 of the 64px raster
  });

  test("layer visibility toggle and removal dispose the raster runtime", async ({ page }) => {
    await importRaster(page, "rgb.tif");
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);

    // probe works while visible
    await expect.poll(async () => {
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      return probeText(page);
    }, { timeout: 20_000 }).toMatch(/px 3\d,\d/);

    // hide the layer (eye icon on the raster row)
    const layers = page.getByRole("complementary", { name: "Layers" });
    const row = layers.getByText("rgb.tif").first();
    await row.click();
    await page.waitForTimeout(300);
    const eye = page.locator("button:has(svg.lucide-eye-off), button:has(svg.lucide-eye)").first();
    await eye.click();
    await page.waitForTimeout(400);
    // re-show — the binding path mesh.visible ← layer.visible stays live
    await eye.click();
    await page.waitForTimeout(600);
    await page.mouse.click(830, 320);
    await page.waitForTimeout(400);
    expect(await probeText(page)).toMatch(/px 3\d,\d/);

    // removal disposes the runtime (§81-82 + Finding H ownership)
    await row.click({ button: "right" });
    await page.getByRole("button", { name: "Remove Layer" }).click();
    await expect.poll(() => runtimes(page), { timeout: 10_000 }).toBe(0);
  });
});
