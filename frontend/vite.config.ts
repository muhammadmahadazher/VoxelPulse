import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the site from /VoxelPulse/; keep "/" for local dev.
  base: process.env.GITHUB_PAGES === "true" ? "/VoxelPulse/" : "/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
  // workers use dynamic imports (laz-perf, proj4) — ES format required
  worker: { format: "es" },
  test: {
    // laz-perf ships a browser build (URL-located wasm) and a Node build;
    // unit tests run in Node and must use the filesystem-located wasm.
    alias: {
      "laz-perf": "laz-perf/lib/node/index.js",
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/api": { target: "http://localhost:8000" },
    },
  },
});
