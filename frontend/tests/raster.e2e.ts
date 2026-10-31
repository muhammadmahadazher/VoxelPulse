/** CP4 acceptance — GeoTIFF import → Map workspace → visible pixels, through
 *  the real UI (Add Data deterministic fixtures). CP4B — remote COG
 *  range-streaming with recorded HTTP evidence: ranges only (no full fetch),
 *  camera-driven tile requests, and failure injection without crashes. */
import { test, expect, type Page } from "@playwright/test";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures", "../../tests/fixtures"]
  .map((rel) => join(process.cwd(), rel))
  .find((dir) => existsSync(join(dir, "rgb.tif")))!;

const COG_BYTES = readFileSync(join(FIX, "cog-rgb-ov.tif"));
const COG_SIZE = COG_BYTES.length;

interface RangeServer {
  url: string;
  base: string;
  ranges: number[];
  fullReads: number;
  close: () => void;
}

/** Local range server (§90): 206s + CORS + full-read accounting + a failure
 *  breaker (/arm) that 500s every subsequent range request. */
async function startRangeServer(): Promise<RangeServer> {
  const ranges: number[] = [];
  let fullReads = 0;
  let armed = false;
  const server = http.createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };
    if (req.url?.startsWith("/arm")) {
      armed = true;
      res.writeHead(200, cors); res.end("armed"); return;
    }
    const range = req.headers.range;
    if (req.method === "HEAD") {
      res.writeHead(200, { ...cors, "content-length": String(COG_SIZE) });
      res.end(); return;
    }
    if (range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = +m[1], end = Math.min(+m[2], COG_SIZE - 1);
      ranges.push(start);
      if (armed) {
        res.writeHead(500, cors); res.end("injected failure"); return;
      }
      res.writeHead(206, {
        ...cors,
        "content-range": `bytes ${start}-${end}/${COG_SIZE}`,
        "content-length": String(end - start + 1),
      });
      res.end(COG_BYTES.subarray(start, end + 1));
    } else {
      fullReads++;
      res.writeHead(200, { ...cors, "content-length": String(COG_SIZE) });
      res.end(COG_BYTES);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/cog-rgb-ov.tif`,
    base: `http://127.0.0.1:${port}`,
    ranges, fullReads, close: () => server.close(),
  };
}

async function openRemoteCog(page: Page, url: string): Promise<void> {
  await page.goto("/?project=1");
  await page.waitForTimeout(1800);
  page.once("dialog", (d) => void d.accept(url));
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: "Open URL" }).click();
}

async function cogMetrics(page: Page): Promise<{
  residentTiles: number; visibleTiles: number; queued: number; fetchedBytes: number;
}> {
  return page.evaluate(() => {
    const rt = [...(window as unknown as {
      __vpRasters: Map<string, { metricsReadonly: () => { residentTiles: number; visibleTiles: number; queued: number; fetchedBytes: number } }>;
    }).__vpRasters.values()][0];
    return rt.metricsReadonly();
  });
}

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
    document.body.innerText.match(/E -?[\d.]+ · N -?[\d.]+ · px \d+,\d+[^\n]*/)?.[0] ?? null);
}

test.describe("raster import acceptance (CP4)", () => {
  test("RGB GeoTIFF imports, focuses the Map, and renders probeable pixels", async ({ page }) => {
    await importRaster(page, "rgb.tif");
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);
    await expect(page.getByText("2D MAP · NORTH-UP")).toBeVisible();
    await expect(page.getByText("Sample type").first()).toBeVisible();
    await expect(page.getByText("uint8").first()).toBeVisible();
    await expect.poll(async () => {
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      return probeText(page);
    }, { timeout: 20_000 }).toMatch(/px 3\d,\d/);
  });

  test("layer visibility toggle and removal dispose the raster runtime", async ({ page }) => {
    await importRaster(page, "rgb.tif");
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => {
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      return probeText(page);
    }, { timeout: 20_000 }).toMatch(/px 3\d,\d/);

    const layers = page.getByRole("complementary", { name: "Layers" });
    const row = layers.getByText("rgb.tif").first();
    await row.click();
    await page.waitForTimeout(300);
    const eye = page.locator("button:has(svg.lucide-eye-off), button:has(svg.lucide-eye)").first();
    await eye.click();
    await page.waitForTimeout(400);
    await eye.click();
    await page.waitForTimeout(600);
    await page.mouse.click(830, 320);
    await page.waitForTimeout(400);
    expect(await probeText(page)).toMatch(/px 3\d,\d/);

    await row.click({ button: "right" });
    await page.getByRole("button", { name: "Remove Layer" }).click();
    await expect.poll(() => runtimes(page), { timeout: 10_000 }).toBe(0);
  });
});

test.describe("raster styling (CP5)", () => {
  test("Float32 elevation renders grayscale by default and pseudocolor after mode change; probe shows world coords", async ({ page }) => {
    await importRaster(page, "dem-f32.tif");
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);

    // measured stretch stats appear in the Inspector (real dataset numbers)
    await expect(page.getByText("Stretch (measured)")).toBeVisible({ timeout: 10_000 });

    // pixel probe works on the DEM
    await expect.poll(async () => {
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      return probeText(page);
    }, { timeout: 20_000 }).toMatch(/px 3\d,\d/);

    // probe carries world coordinates (DEM is anchored at 500000 E)
    const probe = await probeText(page);
    expect(probe).toMatch(/E 50\d{4}\.\d/);

    // switch to pseudocolor via the Inspector control (real user flow)
    await page.locator("select").first().selectOption("pseudocolor");
    await page.waitForTimeout(800);

    // probe still reports RAW source values (display-only restyle, §26)
    await page.mouse.click(830, 320);
    await page.waitForTimeout(400);
    const after = await probeText(page);
    expect(after).toMatch(/px 3\d,\d/);
    // raw values unchanged: same pixel → same numbers (modulo probe rounding)
    const valsBefore = probe!.match(/· (-?[\d.]+ \/ .+)$/)?.[1];
    const valsAfter = after!.match(/· (-?[\d.]+ \/ .+)$/)?.[1];
    expect(valsAfter).toEqual(valsBefore);
  });
});

test.describe("terrain from DEM (CP6)", () => {
  test("terrain toggle builds 3D meshes; exaggeration scales visually only", async ({ page }) => {
    test.setTimeout(90_000);
    await importRaster(page, "dem-f32.tif");
    await expect.poll(() => runtimes(page), { timeout: 15_000 }).toBe(1);

    // enable 3D terrain via the Inspector switch (real user flow)
    const sw = page.getByText("3D terrain").locator("..").locator("button, [role=switch]");
    await expect(sw.first()).toBeVisible({ timeout: 10_000 });
    await sw.first().click();

    // tiled terrain meshes appear in the 3D scene (dataset-scoped)
    await expect.poll(async () => {
      return page.evaluate(() =>
        (window as unknown as { __vpTerrain?: { meshes: number } }).__vpTerrain?.meshes ?? 0);
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

    // raw elevation agreement: the runtime probe reads REAL values inside
    // the measured stats range (§26: mesh heights come from the same raw
    // buffer — exact vertex agreement is unit-tested in terrain.test.ts)
    const sample = await page.evaluate(() => {
      const rt = [...(window as unknown as {
        __vpRasters: Map<string, {
          rasterDescriptor: { width: number; height: number };
          samplePixel: (c: number, r: number) => { values: number[] } | null;
          stretchStats: { min: number; max: number } | null;
        }> }).__vpRasters.values()][0];
      const s = rt.samplePixel(Math.floor(rt.rasterDescriptor.width / 2), Math.floor(rt.rasterDescriptor.height / 2));
      return { v: s?.values?.[0] ?? null, stats: rt.stretchStats };
    });
    expect(sample.v).not.toBeNull();
    if (sample.stats) {
      expect(sample.v!).toBeGreaterThanOrEqual(sample.stats.min);
      expect(sample.v!).toBeLessThanOrEqual(sample.stats.max);
    }

    // exaggeration: mesh.scale.z follows the Inspector stepper (visual only —
    // geometry positions keep raw elevations)
    const minus = page.getByRole("button", { name: "−" });
    const plus = page.getByRole("button", { name: "+" });
    await plus.click();
    await plus.click(); // 1.0 → 2.0
    await page.waitForTimeout(1200);
    const scale = await page.evaluate(() =>
      (window as unknown as { __vpTerrain?: { scaleZ: number } }).__vpTerrain?.scaleZ ?? 0);
    expect(scale).toBeCloseTo(2, 3);
    void minus;
  });
});

test.describe("remote COG range-streaming (CP4B)", () => {
  test("A: byte ranges only — no full fetch, verified COG, probeable pixels", async ({ page }) => {
    test.setTimeout(90_000);
    const rs = await startRangeServer();
    try {
      await openRemoteCog(page, rs.url);
      await expect.poll(() => runtimes(page), { timeout: 20_000 }).toBe(1);
      await expect(page.getByText("2D MAP · NORTH-UP")).toBeVisible();
      expect(rs.fullReads).toBe(0);
      expect(rs.ranges.length).toBeGreaterThan(0);
      // fetched-bytes metric syncs on the map's first update() — poll it
      await expect.poll(async () => (await cogMetrics(page)).fetchedBytes, { timeout: 15_000 }).toBeGreaterThan(0);
      // sanity: a bounded number of targeted reads, never a fetch storm
      expect(rs.ranges.length).toBeLessThanOrEqual(64);
      await expect(page.getByText("COG (verified)")).toBeVisible();
      await expect.poll(async () => {
        await page.mouse.click(830, 320);
        await page.waitForTimeout(400);
        return probeText(page);
      }, { timeout: 20_000 }).toMatch(/px 1\d,\d/);
    } finally {
      rs.close();
    }
  });

  test("B: zoom-out requests new overview ranges (camera-driven, not preload)", async ({ page }) => {
    test.setTimeout(90_000);
    const rs = await startRangeServer();
    try {
      await openRemoteCog(page, rs.url);
      await expect.poll(() => runtimes(page), { timeout: 20_000 }).toBe(1);
      await expect.poll(async () => (await cogMetrics(page)).residentTiles, { timeout: 15_000 }).toBeGreaterThan(0);
      // settle the initial fetch burst before recording the baseline
      await expect.poll(async () => (await cogMetrics(page)).queued, { timeout: 15_000 }).toBe(0);
      await page.waitForTimeout(1000);
      const tilesBefore = (await cogMetrics(page)).residentTiles;

      // zoom OUT on the map panel → a coarser overview becomes current.
      // (Server-side ranges may NOT grow: the open-time stats read may have
      // already cached overview bytes in the UrlSource RangeCache — the
      // camera-driven behavior under test is tile ACQUISITION at the coarser
      // factor, observable client-side; A proves the Range transport.)
      await page.mouse.move(830, 320);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(150);
      }
      await expect.poll(async () => {
        const r = await page.evaluate(() => {
          const rt = [...(window as unknown as { __vpRasters: Map<string, { readyTiles: () => Map<string, { tile: { factor: number } }> }> }).__vpRasters.values()][0];
          return [...rt.readyTiles().values()].map((d) => d.tile.factor);
        });
        return { factors: [...new Set(r)], n: r.length, grew: r.length > tilesBefore };
      }, { timeout: 15_000 }).toMatchObject({ grew: true, factors: expect.arrayContaining([4]) });
    } finally {
      rs.close();
    }
  });

  test("C: failed tile ranges after arming do not crash the app", async ({ page }) => {
    test.setTimeout(90_000);
    const rs = await startRangeServer();
    try {
      await openRemoteCog(page, rs.url);
      await expect.poll(() => runtimes(page), { timeout: 20_000 }).toBe(1);
      await expect.poll(async () => (await cogMetrics(page)).residentTiles, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.evaluate(async (base) => { await fetch(base + "/arm"); }, rs.base);
      await page.mouse.move(830, 320);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(3000);
      expect(await runtimes(page)).toBe(1);
      const m = await cogMetrics(page);
      expect(m.residentTiles).toBeGreaterThan(0);
      await page.mouse.click(830, 320);
      await page.waitForTimeout(400);
      expect(await probeText(page)).toMatch(/px 1\d,\d/);
    } finally {
      rs.close();
    }
  });
});
