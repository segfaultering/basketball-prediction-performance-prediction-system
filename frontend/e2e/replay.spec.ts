import { navigate } from "./helpers";
import { expect, test } from "@playwright/test";

test("the scouting room explores real scenarios and handles unavailable players without saving forecasts", async ({
  page,
}) => {
  await page.route("https://unavailable.example/**", (route) => route.abort());
  await page.goto("/");
  const spotlight = page.getByRole("region", {
    name: "Interactive scouting report",
  });
  const report = spotlight.getByRole("region", {
    name: "Stephen Curry scouting report",
    exact: true,
  });
  await expect(report).toBeVisible();
  const minutes = report.getByRole("slider", {
    name: "Your playing-time scenario",
  });
  await minutes.fill("0");
  await expect(
    report.getByRole("img", { name: /Points projection/ }),
  ).toHaveAttribute("aria-label", /at 0 minutes: 0.0/);
  await minutes.fill("48");
  await expect(
    report.getByRole("img", { name: /Points projection/ }),
  ).toHaveAttribute("aria-label", /at 48 minutes:/);
  await report.getByRole("button", { name: "Assists", exact: true }).click();
  await expect(
    report.getByRole("img", { name: /Assists projection/ }),
  ).toBeVisible();
  await report
    .getByRole("button", { name: "Reveal actual result", exact: true })
    .click();
  await expect(report.getByText(/^Actual playing time:/)).toContainText(
    "Actual playing time: 33.0 minutes",
  );
  await expect(report.getByText("32.0 actual", { exact: true })).toBeVisible();
  await report.getByRole("button", { name: /Recent estimate/ }).click();
  await expect(minutes).toHaveValue("33");
  await spotlight.getByRole("button", { name: /T.J. McConnell/ }).click();
  const benchReport = spotlight.getByRole("region", {
    name: "T.J. McConnell scouting report",
    exact: true,
  });
  await expect(
    benchReport.getByRole("button", {
      name: "Reveal actual result",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await benchReport
    .getByRole("button", { name: "Reveal actual result", exact: true })
    .click();
  await expect(benchReport.getByText(/^Did not play\./)).toBeVisible();
  await expect(benchReport.getByText("DNP", { exact: true })).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("courtside:replay:history:v1"),
    ),
  ).toBeNull();
  await navigate(page, "Forecast history");
  await expect(
    page.getByText(
      "No saved forecasts yet. Generate a prediction to start tracking.",
      { exact: true },
    ),
  ).toBeVisible();
});

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
  await page
    .getByRole("button", { name: "Explore minutes", exact: true })
    .click();
  const minutes = page.getByRole("slider", { name: /Scenario minutes/ });
  await minutes.fill("0");
  await expect(
    page.getByRole("img", { name: /Points forecast by minutes/ }),
  ).toHaveAttribute("aria-label", /At 0 minutes: 0.0/);
  await minutes.fill("48");
  await page.getByLabel("Chart statistic").selectOption("rebounds");
  await expect(
    page.getByRole("img", { name: /Rebounds forecast by minutes/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
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
