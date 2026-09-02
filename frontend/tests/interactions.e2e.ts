import { test, expect } from "@playwright/test";

/** Phase 1.6 interaction acceptance — real browser flows, no code-path
 *  inspection. Uses accessible roles/names, not brittle CSS. */

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
});
test.afterEach(async () => {
  // VPF1 backend absence is an expected, documented fallback — filter it
  const real = errors.filter((e) => !/websocket|ws:\/\/|net::ERR/i.test(e));
  expect(real, `unexpected app errors: ${real.join(" | ")}`).toHaveLength(0);
});

async function openWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/?project=1");
  await page.waitForTimeout(3000); // sim engine spin-up
  await expect(page.getByText("Layers", { exact: true })).toBeVisible();
}

test("demo flow: start screen loads Urban demo and workspace appears", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Urban LiDAR Demo/ }).click();
  await page.waitForTimeout(3000);
  await expect(page.getByText("LiDAR Point Cloud")).toBeVisible();
  await expect(page.getByText("DEMO DATA")).toBeVisible();
});

test("layer selection syncs layer tree and inspector", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("treeitem", { name: /LiDAR Point Cloud/ }).click();
  await expect(page.getByText("Display")).toBeVisible();
  await expect(page.getByText("Rendering")).toBeVisible();
  await expect(page.getByText("Height min")).toBeVisible(); // RANGE section from real data
});

test("layer visibility toggles the point cloud off and on", async ({ page }) => {
  await openWorkspace(page);
  const ptsRow = (page.getByRole("treeitem", { name: /LiDAR Point Cloud/ }));
  await ptsRow.getByRole("button", { name: "Hide layer" }).click();
  await page.waitForTimeout(800);
  await expect(page.getByText("0 pts visible")).toBeVisible();
  await ptsRow.getByRole("button", { name: "Show layer" }).click();
  await page.waitForTimeout(800);
  await expect(page.getByText(/1?\d[\d,]* pts visible/)).toBeVisible();
});

test("colormap and point size controls update state", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("treeitem", { name: /LiDAR Point Cloud/ }).click();
  const cmap = page.getByRole("combobox");
  await cmap.selectOption("turbo");
  await expect(page.locator("select")).toHaveValue("turbo");
  const sizeUp = page.getByTitle("Point size").getByText("+");
  if (await sizeUp.count()) await sizeUp.click();
});

test("EDL toggle switches state", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("treeitem", { name: /LiDAR Point Cloud/ }).click();
  await page.getByRole("switch", { name: "Eye-Dome Lighting" }).click();
  await expect(page.getByRole("switch", { name: "Eye-Dome Lighting" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "Eye-Dome Lighting" }).click();
  await expect(page.getByRole("switch", { name: "Eye-Dome Lighting" })).toHaveAttribute("aria-checked", "true");
});

test("command palette opens with keyboard and executes a command", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Search commands, tools, layers…")).toBeVisible();
  await page.keyboard.type("layout: split");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await expect(page.getByText("BEV · ORTHO TOP-DOWN")).toBeVisible();
  await page.keyboard.press("v"); // cycle back through layouts
});

test("menu: View > Maximize Viewport works and restores", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Maximize Viewport" }).click();
  await page.waitForTimeout(400);
  await expect(page.getByRole("complementary", { name: "Layers" })).toBeHidden();
  await page.keyboard.press("Shift+f");
  await page.waitForTimeout(400);
  await expect(page.getByRole("complementary", { name: "Layers" })).toBeVisible();
});

test("timeline: pause, seek, speed change", async ({ page }) => {
  await openWorkspace(page);
  const track = page.getByRole("slider", { name: "timeline" });
  await track.click({ position: { x: 200, y: 10 } }); // seek into the buffer
  await expect(page.getByText(/REPLAY/)).toBeVisible();
  const half = page.getByRole("tab", { name: "0.5×" });
  await half.click();
  await expect(half).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Play / Pause" }).click(); // exit replay
  await expect(page.getByText("● LIVE")).toBeVisible();
  await page.getByRole("button", { name: "Return to live" }).click();
  await expect(page.getByText("● LIVE")).toBeVisible();
});

test("timeline collapses to compact and persists", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Expand timeline" }).click();
  await expect(page.getByRole("button", { name: "console" })).toBeVisible();
  await page.getByRole("button", { name: "Compact timeline" }).click();
  await page.reload();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("button", { name: "Expand timeline" })).toBeVisible();
});

test("panel resize: inspector divider persists after refresh", async ({ page }) => {
  await openWorkspace(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const box = await inspector.boundingBox();
  const divider = page.locator('div[aria-label="Inspector"] > div.cursor-col-resize');
  await divider.hover();
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 320, box!.y + 300);
  await page.mouse.up();
  const resized = await inspector.boundingBox();
  expect(Math.abs(resized!.width - 320)).toBeLessThan(12);
  await page.reload();
  await page.waitForTimeout(2500);
  const after = await page.getByRole("complementary", { name: "Inspector" }).boundingBox();
  expect(Math.abs(after!.width - resized!.width)).toBeLessThan(12);
});

test("tiny file import via Add Data renders a new layer", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#vp-add-data").setInputFiles("tests/fixtures/tiny.xyz");
  const layers = page.getByRole("complementary", { name: "Layers" });
  await expect(layers.getByText("tiny.xyz")).toBeVisible({ timeout: 10000 });
  await expect(layers.getByText("30", { exact: true })).toBeVisible(); // point count chip
  await expect(
    page.getByRole("complementary", { name: "Inspector" }).getByText("Points"),
  ).toBeVisible(); // inspector metadata
});

test("LAS import populates dataset metadata in the inspector (Phase 2)", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#vp-add-data").setInputFiles("tests/fixtures/tiny.las");
  const layers = page.getByRole("complementary", { name: "Layers" });
  await expect(layers.getByText("tiny.las")).toBeVisible({ timeout: 15000 });
  await layers.getByText("tiny.las").click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByText("las", { exact: true })).toBeVisible(); // format row
  await expect(inspector.getByText("40", { exact: true })).toBeVisible(); // dataset pointCount
  await expect(inspector.getByText("Fields")).toBeVisible(); // field schema from adapter
});

test("large import keeps the UI responsive (worker decode, §55)", async ({ page }) => {
  await openWorkspace(page);
  // ~400k-point XYZ generated in-test — no giant fixture committed (§56)
  const lines: string[] = [];
  for (let i = 0; i < 400_000; i++) {
    lines.push(`${(i % 97) * 0.5} ${(i % 53) * 0.25} ${(i % 31) * 0.1} ${((i % 100) / 100).toFixed(3)}`);
  }
  await page.evaluate(() => {
    const w = window as unknown as { __vpRafGapMs?: number };
    w.__vpRafGapMs = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.__vpRafGapMs = Math.max(w.__vpRafGapMs ?? 0, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator("#vp-add-data").setInputFiles({
    name: "big.xyz", mimeType: "text/plain", buffer: Buffer.from(lines.join("\n")),
  });
  const layers = page.getByRole("complementary", { name: "Layers" });
  await expect(layers.getByText("big.xyz")).toBeVisible({ timeout: 30000 });
  await expect(layers.getByText("400k")).toBeVisible();
  const gap = await page.evaluate(() => (window as unknown as { __vpRafGapMs: number }).__vpRafGapMs);
  expect(gap).toBeLessThan(2000); // no multi-second main-thread freeze
});

test("repeated import/remove cycles stay clean (§62)", async ({ page }) => {
  await openWorkspace(page);
  const layers = page.getByRole("complementary", { name: "Layers" });
  for (let i = 0; i < 5; i++) {
    await page.locator("#vp-add-data").setInputFiles("tests/fixtures/tiny.pcd");
    await expect(layers.getByText("tiny.pcd").first()).toBeVisible({ timeout: 15000 });
    await layers.getByText("tiny.pcd").first().click({ button: "right" });
    await page.getByRole("button", { name: "Remove Layer" }).click();
    await expect(layers.getByText("tiny.pcd")).toHaveCount(0, { timeout: 10000 });
  }
});

test("detection selection populates inspector", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("Space"); // pause the stream for a stable target
  await page.waitForTimeout(600);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  // probe several positions across the cloud — one should hit a point
  let hit = 0;
  const spots = [
    [0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.4, 0.5], [0.6, 0.55], [0.5, 0.42],
  ];
  for (const [fx, fy] of spots) {
    await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
    await page.waitForTimeout(400);
    hit =
      (await page.getByText("Point Probe").count()) +
      (await page.getByText(/TRK-\d{4}/).count());
    if (hit > 0) break;
  }
  await page.keyboard.press("Space"); // resume
  expect(hit).toBeGreaterThan(0);
});
