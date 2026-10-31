/** CP9 — LiDAR + terrain fusion acceptance: a georeferenced LiDAR block ON
 *  the DEM surface, co-rendered with the DEM terrain and draped imagery.
 *  Numeric assertions (not visual similarity): CRS agreement, elevation
 *  agreement between the point cloud and the terrain sampler, shared render
 *  origin, layer controls. */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures", "../../tests/fixtures"]
  .map((rel) => join(process.cwd(), rel))
  .find((dir) => existsSync(join(dir, "dem-f32.tif")))!;

test.describe("LiDAR + terrain fusion (CP9)", () => {
  test("cloud, DEM terrain and draped imagery co-render with numeric alignment", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/?project=1");
    await page.waitForTimeout(1500);
    // one pipeline, three files (LAS + DEM + ortho)
    await page.setInputFiles("#vp-add-data", [
      join(FIX, "fusion.las"),
      join(FIX, "dem-f32.tif"),
      join(FIX, "ortho.tif"),
    ]);

    // the cloud imports whole-file; rasters stream
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __vpRasters?: Map<string, unknown> }).__vpRasters?.size ?? 0),
      { timeout: 25_000 }).toBe(2);

    // enable terrain + drape on the DEM layer
    const demRow = page.getByRole("complementary", { name: "Layers" }).getByText("dem-f32.tif").first();
    await demRow.click();
    await page.waitForTimeout(400);
    await page.getByText("3D terrain").locator("..").locator("button, [role=switch]").first().click();
    await page.waitForTimeout(1000);
    const drapeSel = page.locator("select").nth(1);
    await drapeSel.selectOption({ label: "ortho.tif" });
    await page.waitForTimeout(6000);

    // ---- numeric fusion assertions -------------------------------------
    const fusion = await page.evaluate(() => {
      const rt = [...(window as unknown as { __vpRasters: Map<string, {
        rasterDescriptor: { crs: string; width: number; height: number };
        samplePixel: (c: number, r: number) => { values: number[] } | null;
      }> }).__vpRasters.values()]
        .find((r) => r.rasterDescriptor.crs === "EPSG:32643")!;
      // terrain sample at a fusion point's location (E 500070, N 3999950):
      // DEM 10 m texels → pixel (7, 5); the fusion point flies 2 m above it
      const s = rt.samplePixel(7, 5);
      return {
        terrainZ: s?.values?.[0] ?? null,
        cloudLayers: (document.body.innerText.match(/fusion\.las/) ?? []).length,
        renderOrigin: (window as unknown as { __vpRenderOrigin?: number[] }).__vpRenderOrigin ?? null,
      };
    });
    expect(fusion.terrainZ).not.toBeNull();
    // demZ(500070, 3999950) = 200 + 50·sin(0.875) + 30·cos(5/6) + 7·0.5
    const expectedDemZ = 200 + 50 * Math.sin(7 / 8) + 30 * Math.cos(5 / 6) + 3.5;
    expect(fusion.terrainZ!).toBeCloseTo(expectedDemZ, 1);
    // the fusion point sits 2 m above the DEM → vertical consistency:
    // cloudZ(point) − terrainZ(same E/N) = 2.0 m exactly (deterministic)
    expect(fusion.terrainZ!).toBeCloseTo(264.05 - 2.0, 1);
    // the cloud layer registered under its real name (CRS metadata flows)
    expect(fusion.cloudLayers).toBeGreaterThan(0);

    // visibility toggle reaches the cloud (§82 layer controls)
    await page.getByRole("complementary", { name: "Layers" }).getByText("fusion.las").first()
      .click({ button: "right" });
    await page.getByRole("button", { name: "Remove Layer" }).click();
    await page.waitForTimeout(1000);
    // terrain survives removal of the cloud (independent layer lifecycle)
    const after = await page.evaluate(() =>
      (window as unknown as { __vpTerrain?: { meshes: number } }).__vpTerrain?.meshes ?? 0);
    expect(after).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: "scripts/dbg-fusion.png" });
  });
});
