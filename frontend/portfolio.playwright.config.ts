import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  workers: 1,
  testDir: "./e2e",
  testMatch: "**/replay.spec.ts",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8013", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run preview -- --base / --host 127.0.0.1 --port 8013",
    url: "http://127.0.0.1:8013/",
    reuseExistingServer: false,
  },
});
