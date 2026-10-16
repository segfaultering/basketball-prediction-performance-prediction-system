import { navigate } from "./helpers";
import { test, expect } from "@playwright/test";

test("generates selected daily forecasts and saves them to history", async ({
  page,
}, info) => {
  await page.goto("/ui/");
  await navigate(page, "Daily forecasts");
  const board = page.getByRole("region", { name: "Daily forecast board" });
  await expect(board.getByRole("checkbox")).toHaveCount(2);
  await board.getByRole("button", { name: "Select visible players" }).click();
  await board
    .getByRole("button", { name: "Generate selected forecasts (2)" })
    .click();
  await expect(board.getByRole("status")).toHaveText(
    "Batch finished: 2 of 2 players processed.",
    { timeout: 45_000 },
  );
  await expect(board.getByRole("table").getByRole("row")).toHaveCount(3);
  await board.getByLabel("Team", { exact: true }).selectOption("LAL");
  await expect(board.getByRole("table").getByRole("row")).toHaveCount(2);
  await board.getByText("Forecast details").click();
  await expect(board.getByText(/^Saved:/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("daily-forecasts.png"),
    fullPage: true,
  });
  await navigate(page, "Forecast history");
  await expect(
    page
      .locator(".tracking-record")
      .filter({ hasText: "Demo Lakers Player" })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".tracking-record")
      .filter({ hasText: "Demo Celtics Player" })
      .first(),
  ).toBeVisible();
});

test("switches themes and preserves the selection across reloads", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/ui/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(24, 25, 22)",
  );
  await expect(page.locator(".selection-panel")).toHaveCSS(
    "background-color",
    "rgb(34, 35, 31)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("dark.png"), fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await navigate(page, "Forecast history");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await navigate(page, "How it works");
  await expect(
    page.getByRole("dialog", { name: "How forecasts work", exact: true }),
  ).toHaveCSS("background-color", "rgb(34, 35, 31)");
  await page.getByRole("button", { name: "Close explanation" }).click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

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
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore minutes" }).click();
  const scenarioMinutes = page.getByRole("slider", {
    name: /Scenario minutes/,
  });
  await scenarioMinutes.fill("0");
  await expect(
    page.getByRole("img", { name: /Points forecast by minutes/ }),
  ).toHaveAttribute("aria-label", /At 0 minutes: 0.0/);
  await scenarioMinutes.fill("48");
  await page.getByLabel("Chart statistic").selectOption("assists");
  await expect(
    page.getByRole("img", { name: /Assists forecast by minutes/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("minutes-explorer.png"),
    fullPage: true,
  });
  await navigate(page, "Forecast history");
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
  await navigate(page, "Forecast history");
  await expect(page.locator(".tracking-record").first()).toBeVisible();
  await navigate(page, "Player predictions");
  await page.locator(".player-option").first().click();
  await page.getByRole("button", { name: "Generate prediction" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({
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
  await navigate(page, "Model insights");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Baseline MAE", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await navigate(page, "How it works");
  await expect(
    page.getByRole("dialog", { name: "How forecasts work", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close explanation" }).click();
  await expect(
    page.getByRole("dialog", { name: "How forecasts work", exact: true }),
  ).not.toBeVisible();
  await navigate(page, "Player predictions");
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

test("slides navigation open and supports keyboard and backdrop dismissal", async ({
  page,
}) => {
  await page.goto("/ui/");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).not.toBeVisible();
  await toggle.click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const bounds = await drawer.boundingBox();
  if (!bounds) throw new Error("Navigation drawer has no bounds");
  await page.mouse.click(bounds.x + bounds.width + 8, 200);
  await expect(drawer).not.toBeVisible();
  await navigate(page, "Forecast history");
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Forecast history." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
