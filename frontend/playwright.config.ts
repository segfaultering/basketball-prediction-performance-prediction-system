import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  workers: 1,
  testDir: "./e2e",
  testIgnore: ["**/replay.spec.ts", "**/auth.spec.ts"],
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8012", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "uv run --project .. uvicorn bpps.api:app --host 127.0.0.1 --port 8012",
    env: {
      DEBUG: "0",
      STUB_MODE: "1",
      PROJ_DIR: resolve("../.cache/bpps/e2e"),
    },
    url: "http://127.0.0.1:8012/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
