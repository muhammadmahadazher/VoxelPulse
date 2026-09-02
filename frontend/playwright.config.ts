import { defineConfig } from "@playwright/test";

/** Screenshot-driven visual regression for major workspace states.
 *  Tolerant thresholds: anti-aliasing / GPU variance must not break CI.
 *  VP_PORT overrides the dev-server port (local zombie-port escape hatch). */
const PORT = Number(process.env.VP_PORT ?? 5173);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  snapshotPathTemplate: "{testDir}/visual-baselines/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: "disabled" },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
