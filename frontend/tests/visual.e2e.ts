import { test, expect } from "@playwright/test";

/** Visual regression — Phase 1.6 acceptance screens.
 *  The workspace shots pause the live sim first (Space) so the WebGL canvas
 *  is deterministic across runs; baselines regenerate with:
 *  npx playwright test tests/visual.e2e.ts --update-snapshots */

async function openPaused(page: import("@playwright/test").Page, settle = 4000) {
  await page.goto("/?project=1");
  await page.waitForTimeout(settle);
  await page.keyboard.press("Space"); // freeze the stream → stable canvas
  await page.waitForTimeout(600);
}

test("start screen @1280", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(page).toHaveScreenshot("start-1280.png");
});

test("workspace @1280", async ({ page }) => {
  await openPaused(page);
  await expect(page).toHaveScreenshot("workspace-1280.png");
});

test("workspace @1920", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openPaused(page);
  await expect(page).toHaveScreenshot("workspace-1920.png");
});

test("command palette @1920", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openPaused(page);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(600);
  await expect(page).toHaveScreenshot("palette-1920.png");
});

