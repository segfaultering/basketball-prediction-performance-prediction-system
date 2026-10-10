import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
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
      "DEBUG=0 STUB_MODE=1 uv run --project .. uvicorn bpps.api:app --host 127.0.0.1 --port 8012",
    url: "http://127.0.0.1:8012/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
