import { test, expect } from "@playwright/test";

/** Visual regression — Phase 1.5 acceptance screens.
 *  Baselines regenerate with: npx playwright test --update-snapshots */

test("start screen @1280", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(page).toHaveScreenshot("start-1280.png");
});

test("workspace @1280", async ({ page }) => {
  await page.goto("/?project=1");
  await page.waitForTimeout(4000);
  await expect(page).toHaveScreenshot("workspace-1280.png");
});

test("workspace @1920", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?project=1");
  await page.waitForTimeout(4000);
  await expect(page).toHaveScreenshot("workspace-1920.png");
});

test("command palette @1920", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?project=1");
  await page.waitForTimeout(3000);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(600);
  await expect(page).toHaveScreenshot("palette-1920.png");
});
