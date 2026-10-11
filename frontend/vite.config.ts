import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/ui/",
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      [
        "/health",
        "/games",
        "/teams",
        "/predictions",
        "/player-research",
        "/backtests",
        "/forecasts",
        "/docs",
        "/openapi.json",
      ].map((path) => [path, "http://127.0.0.1:8000"]),
    ),
  },
  test: {
    maxWorkers: 1,
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    restoreMocks: true,
  },
});
