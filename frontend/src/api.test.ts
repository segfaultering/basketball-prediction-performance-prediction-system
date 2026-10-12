import { afterEach, expect, it, vi } from "vitest";
import { request, seasonFor, shiftDate, tipoff } from "./api";

afterEach(() => vi.unstubAllGlobals());
it.each([
  [429, "60", "Forecast limit reached. Please wait about 1 minute"],
  [429, "120", "Forecast limit reached. Please wait about 2 minutes"],
  [429, "invalid", "Forecast limit reached. Please wait a minute"],
  [429, null, "Forecast limit reached. Please wait a minute"],
  [503, "5", "Please try again in about 5 seconds"],
])(
  "explains retryable status %s with Retry-After %s",
  async (status, retry, text) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Upstream error", {
            status: Number(status),
            headers: retry ? { "Retry-After": String(retry) } : {},
          }),
      ),
    );
    await expect(request("/predictions")).rejects.toThrow(String(text));
  },
);
it("preserves storage errors instead of calling them a busy forecast service", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: "Forecast history storage is unavailable; retry later.",
          }),
          { status: 503 },
        ),
    ),
  );
  await expect(request("/predictions")).rejects.toThrow(
    "Forecast history storage is unavailable",
  );
});
it("uses UTC season and date boundaries", () => {
  expect(seasonFor("2026-06-30")).toBe("2025-26");
  expect(seasonFor("2026-07-01")).toBe("2026-27");
  expect(shiftDate("2024-03-01", -1)).toBe("2024-02-29");
});
it("handles structured API validation errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: [{ msg: "Invalid player" }] }), {
          status: 422,
        }),
    ),
  );
  await expect(request("/predictions")).rejects.toThrow("Invalid player");
});
it("preserves explicit UTC offsets when formatting tipoff", () => {
  const game = {
    game_id: "1",
    date: "2026-10-09",
    status: 1,
    home_team: "LAL",
    away_team: "BOS",
    home_team_id: "1",
    away_team_id: "2",
    tipoff_utc: "2026-10-09T20:00:00+00:00",
  };
  expect(tipoff(game)).toBe("8:00 PM UTC");
});
