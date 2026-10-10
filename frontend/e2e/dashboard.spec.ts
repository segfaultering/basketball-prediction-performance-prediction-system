import { test, expect } from "@playwright/test";

test("predicts with real synthetic API and handles selection changes", async ({
  page,
}, info) => {
  await page.goto("/ui/");
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  const player = page.locator(".player-option").first();
  await expect(player).toBeVisible();
  await player.click();
  await page.getByRole("checkbox", { name: "Set expected minutes" }).check();
  await page.getByRole("slider", { name: "Expected minutes" }).fill("32");
  await page.getByRole("button", { name: "Generate prediction" }).click();
  await expect(page.locator(".forecast-meta")).toContainText("32.0", {
    timeout: 45_000,
  });
  await expect(
    page.locator(".stat-card").first().locator(".stat-value"),
  ).not.toContainText("—");
  await expect(page.locator(".synthetic-notice")).toBeVisible();
  await expect(page.getByText("Saved to forecast history")).toBeVisible();
  await page
    .getByRole("button", { name: "Forecast history", exact: true })
    .click();
  await expect(page.locator(".tracking-record").first()).toBeVisible();
  await page
    .locator(".tracking-record")
    .first()
    .locator("summary")
    .first()
    .click();
  await expect(page.locator(".tracking-record").first()).toContainText(
    "32.0 expected minutes",
  );
  await expect(page.locator(".tracking-record").first()).toContainText(
    "Pending result",
  );
  await page
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(page.getByText("Updated 0 forecast records.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("tracking.png"),
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Forecast history", exact: true })
    .click();
  await expect(page.locator(".tracking-record").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Player predictions", exact: true })
    .click();
  await page.locator(".player-option").first().click();
  await page.getByRole("button", { name: "Generate prediction" }).click();
  await expect(page.getByText("Saved to forecast history")).toBeVisible({
    timeout: 45_000,
  });
  await page.screenshot({
    path: info.outputPath("forecast.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Model insights", exact: true })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Baseline MAE", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "How it works", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close explanation" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Player predictions", exact: true })
    .click();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByText(/No scheduled games on/)).toBeVisible();
  await expect(
    page.locator(".stat-card").first().locator(".stat-value"),
  ).toContainText("—");
  await expect(
    page.getByRole("button", { name: "Generate prediction" }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("empty.png"), fullPage: true });
});

test("surfaces API errors and retry succeeds", async ({ page }) => {
  await page.route("**/games?*", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ detail: "NBA schedule unavailable" }),
    }),
  );
  await page.goto("/ui/");
  await expect(page.getByRole("alert")).toContainText(
    "NBA schedule unavailable",
  );
  await page.unroute("**/games?*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".player-option").first()).toBeVisible();
});
