import { expect, test } from "@playwright/test";

test("email sign-in persists, sends a bearer token, and clears private history on sign-out", async ({
  page,
}) => {
  const user = {
    id: "b2240399-bd98-4e59-8390-d0d40b762b74",
    aud: "authenticated",
    role: "authenticated",
    email: "player@example.com",
    email_confirmed_at: "2026-10-12T00:00:00Z",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-12T00:00:00Z",
  };
  // The real Supabase SDK talks to intercepted auth responses here; real JWT
  // signatures and API isolation are tested separately in the Python suite.
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.fixture`;
  let authenticatedRequests = 0;
  await page.route("https://auth-fixture.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/token")) {
      const body = route.request().postDataJSON();
      expect(body.email).toBe(user.email);
      expect(body.password).toBe("password123");
      await route.fulfill({
        json: {
          access_token: token,
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user,
        },
      });
    } else if (path.endsWith("/logout")) {
      await route.fulfill({ status: 204 });
    } else if (path.endsWith("/user")) {
      await route.fulfill({ json: user });
    } else await route.abort();
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") {
      await route.fulfill({
        json: {
          status: "ok",
          stub_mode: false,
          auth_enabled: true,
          backtests_enabled: false,
        },
      });
      return;
    }
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    authenticatedRequests += 1;
    if (path === "/api/games") await route.fulfill({ json: { games: [] } });
    else if (path === "/api/forecasts")
      await route.fulfill({
        json: {
          stub_mode: false,
          total: 0,
          forecasts: [],
          summary: {
            tracked_games: 0,
            evaluated_games: 0,
            pending_games: 0,
            did_not_play_games: 0,
            stats: {},
          },
        },
      });
    else await route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Live NBA", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Courtside" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No scheduled games", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Live NBA", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Forecast history", exact: true })
    .click();
  await expect(
    page.getByText("Forecast history is private to your account", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Courtside" }),
  ).toBeVisible();
  await expect(
    page.getByText("Forecast history is private to your account", {
      exact: false,
    }),
  ).toHaveCount(0);
  expect(authenticatedRequests).toBeGreaterThanOrEqual(3);
});
