import { defineConfig } from "@playwright/test";

/** Screenshot-driven visual regression for major workspace states.
 *  Tolerant thresholds: anti-aliasing / GPU variance must not break CI. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  snapshotPathTemplate: "{testDir}/visual-baselines/{arg}{ext}",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 720 },
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: "disabled" },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
