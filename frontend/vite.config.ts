import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the site from /VoxelPulse/; keep "/" for local dev.
  base: process.env.GITHUB_PAGES === "true" ? "/VoxelPulse/" : "/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/api": { target: "http://localhost:8000" },
    },
  },
});
