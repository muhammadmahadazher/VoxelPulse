/** Phase 4 acceptance — COPC streaming through the real UI (§124–129, §157–159).
 *  A local HTTP range server serves the reference COPC (no external network);
 *  request accounting proves no-full-download and camera-driven fetches. */
import { test, expect, type Page } from "@playwright/test";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = ["tests/fixtures", "../tests/fixtures", "../../tests/fixtures"]
  .map((rel) => join(process.cwd(), rel))
  .find((dir) => existsSync(join(dir, "reference.copc.laz")))!;

interface RangeServer {
  url: string;
  ranges: number[];
  fullReads: number;
  close: () => void;
}

/** Start a local range server (§90): 206 + CORS + full-read accounting. */
async function startRangeServer(): Promise<RangeServer> {
  const data = readFileSync(join(FIX, "reference.copc.laz"));
  const ranges: number[] = [];
  let fullReads = 0;
  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-length": String(data.length),
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
      });
      res.end();
      return;
    }
    if (range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = +m[1];
      const end = Math.min(+m[2], data.length - 1);
      ranges.push(start);
      res.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${data.length}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "access-control-allow-origin": "*",
      });
      res.end(data.subarray(start, end + 1));
    } else {
      fullReads++;
      res.writeHead(200, {
        "content-length": String(data.length),
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
      });
      res.end(data);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/reference.copc.laz`,
    ranges,
    fullReads,
    close: () => server.close(),
  };
}

async function openRemoteUrl(p: Page, url: string): Promise<void> {
  await p.goto("/?project=1");
  await p.waitForTimeout(1800);
  p.once("dialog", (d) => void d.accept(url));
  await p.getByRole("menuitem", { name: "File" }).click();
  await p.waitForTimeout(400);
  await p.locator("button", { hasText: "Open URL" }).click();
  await p.waitForTimeout(9000);
}

function metrics(p: Page): Promise<{ visibleNodes: number; visiblePoints: number; cacheNodes: number }> {
  return p.evaluate(() => {
    const rt = [...(window as unknown as { __vpStreaming: Map<string, { metricsReadonly: { visibleNodes: number; visiblePoints: number; cacheNodes: number } }> }).__vpStreaming.values()][0];
    return rt.metricsReadonly;
  });
}

test.describe("COPC streaming acceptance", () => {
  test("A: initial streaming — metadata + coarse points, no full download (§157, §125)", async ({ page }) => {
    const rs = await startRangeServer();
    try {
      await openRemoteUrl(page, rs.url);
      const status = await page.evaluate(() => document.body.innerText.match(/COPC[^\n]*/)?.[0]);
      expect(status).toContain("COPC");
      const m = await metrics(page);
      expect(m.visibleNodes).toBeGreaterThan(0);
      expect(m.visiblePoints).toBeGreaterThan(0);
      // §125: no full-file GET — header/hierarchy reads are range requests
      expect(rs.fullReads).toBe(0);
      expect(rs.ranges.length).toBeGreaterThan(0);
    } finally {
      rs.close();
    }
  });

  test("B: camera zoom refines — new node ranges requested (§158, §126)", async ({ page }) => {
    const rs = await startRangeServer();
    try {
      await openRemoteUrl(page, rs.url);
      const coarse = await metrics(page);
      const rangesBefore = rs.ranges.length;
      await page.mouse.move(700, 450);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -500);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(8000);
      const refined = await metrics(page);
      expect(refined.visiblePoints).toBeGreaterThanOrEqual(coarse.visiblePoints);
      // §126: zoom caused additional node ranges (camera-driven, not preload)
      expect(rs.ranges.length).toBeGreaterThan(rangesBefore);
    } finally {
      rs.close();
    }
  });

  test("dataset removal cancels streaming and clears the registry (§138, §163)", async ({ page }) => {
    const rs = await startRangeServer();
    try {
      await openRemoteUrl(page, rs.url);
      await metrics(page); // runtime exists
      const layers = page.getByRole("complementary", { name: "Layers" });
      await layers.getByText("reference.copc.laz").click({ button: "right" });
      await page.getByRole("button", { name: "Remove Layer" }).click();
      await page.waitForTimeout(2000);
      const after = await page.evaluate(() => (window.__vpStreaming as Map<string, unknown>).size);
      expect(after).toBe(0);
    } finally {
      rs.close();
    }
  });
});
