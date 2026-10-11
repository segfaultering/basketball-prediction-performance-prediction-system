import { expect, test } from "@playwright/test";

async function navigate(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

test("the portfolio replay works with no API and keeps historical results labeled", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  await page.route("https://unavailable.example/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await expect(
    page.getByText("March 8, 2025 replay", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".player-option")).not.toHaveCount(0);
  await page.locator(".player-option").first().click();
  await page
    .getByRole("button", { name: "Generate prediction", exact: true })
    .click();
  await expect(page.getByText("Saved replay", { exact: true })).toBeVisible();
  await navigate(page, "Model insights");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(
    page.getByText(/Prepared expanding-window backtest/),
  ).toBeVisible();
  await navigate(page, "Daily forecasts");
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  await page.getByRole("button", { name: "Select visible players" }).click();
  await page
    .getByRole("button", { name: "Generate selected forecasts (6)" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Batch finished: 6 of 6 players processed.",
  );
  await navigate(page, "Forecast history");
  await page
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "Replay comparisons" }),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await navigate(page, "Forecast history");
  await expect(page.locator(".tracking-record")).toHaveCount(7);
});

test("an unavailable live API can be left without losing the offline demo", async ({
  page,
}) => {
  await page.route("https://unavailable.example/**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Live NBA", exact: true }).click();
  await expect(
    page.getByText(/Live data could not be reached/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "NBA replay", exact: true }).click();
  await expect(page.locator(".player-option")).not.toHaveCount(0);
  await page.locator(".player-option").first().click();
  await page
    .getByRole("button", { name: "Generate prediction", exact: true })
    .click();
  await expect(page.getByText("Saved replay", { exact: true })).toBeVisible();
});
