import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForecastTracking from "./ForecastTracking";
import { STATS } from "./api";
import type { ForecastHistory, TrackedForecast } from "./api";

function history(total = 0): ForecastHistory {
  const record: TrackedForecast = {
    id: "saved-1",
    created_at: "2026-01-02T12:00:00+00:00",
    updated_at: null,
    primary: true,
    status: "pending",
    inputs: {
      player_id: "1",
      game_id: "game",
      season_type: "Regular Season",
      minutes: 32,
      seasons: null,
    },
    prediction: {
      player_id: "1",
      player_name: "Alex Player",
      game_id: "game",
      game_date: "2026-01-03",
      team: "LAL",
      opponent: "BOS",
      home: true,
      projected_minutes: 32,
      history_games: 100,
      last_history_date: "2026-01-01",
      stub_mode: true,
      warnings: [],
      stats: Object.fromEntries(
        STATS.map((s) => [
          s,
          { prediction: 20, approximate_80pct_range: [10, 30] },
        ]),
      ) as TrackedForecast["prediction"]["stats"],
      baseline: {
        stats: Object.fromEntries(
          STATS.map((s) => [s, 18]),
        ) as TrackedForecast["prediction"]["baseline"]["stats"],
        parameters: {},
      },
      model: {
        status: "trained",
        cache_hit: false,
        trained_through: "2026-01-01",
        stats: {},
      },
    },
    outcome: null,
    errors: null,
  };
  return {
    stub_mode: true,
    total,
    forecasts: total ? [record] : [],
    summary: {
      tracked_games: total ? 1 : 0,
      evaluated_games: 0,
      pending_games: total ? 1 : 0,
      did_not_play_games: 0,
      stats: Object.fromEntries(
        STATS.map((s) => [
          s,
          { mae: null, rmse: null, baseline_mae: null, range_coverage: null },
        ]),
      ) as ForecastHistory["summary"]["stats"],
    },
  };
}

const json = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("forecast history", () => {
  it("explains empty history and labels synthetic records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(history())),
    );
    render(<ForecastTracking />);
    expect(await screen.findByText(/No saved forecasts yet/)).toBeTruthy();
    expect(
      screen.getByText(/These results do not measure NBA accuracy/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh results",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("refreshes actuals without changing saved predictions", async () => {
    let data = history(1);
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/forecasts/refresh") {
          data = history(1);
          data.forecasts[0].status = "settled";
          data.forecasts[0].outcome = {
            minutes: 30,
            stats: Object.fromEntries(STATS.map((s) => [s, 22])) as Record<
              (typeof STATS)[number],
              number
            >,
          };
          data.forecasts[0].errors = Object.fromEntries(
            STATS.map((s) => [s, -2]),
          ) as Record<(typeof STATS)[number], number>;
          data.summary.evaluated_games = 1;
          data.summary.pending_games = 0;
          for (const stat of STATS)
            data.summary.stats[stat] = {
              mae: 2,
              rmse: 2,
              baseline_mae: 4,
              range_coverage: 1,
            };
          return json({ updated_forecasts: 1, errors: [] });
        }
        return json(data);
      }),
    );
    render(<ForecastTracking />);
    await screen.findByText("Alex Player");
    expect(screen.getByText("Pending result")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
    await screen.findByText("Result available");
    expect(screen.getByText("Saved forecast accuracy")).toBeTruthy();
    expect(screen.getAllByText("20.0")).toHaveLength(5);
    expect(screen.getAllByText("22.0")).toHaveLength(5);
    expect(screen.getAllByText("-2.0")).toHaveLength(5);
    expect(screen.getAllByText("100%")).toHaveLength(5);
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([path]) => path === "/forecasts/refresh");
    expect(post?.[1]?.method).toBe("POST");
  });

  it("reports refresh failures and supports history retry and pagination", async () => {
    let failed = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/forecasts/refresh")
          return json({
            updated_forecasts: 0,
            errors: [
              { player_id: "1", season: "2025-26", detail: "NBA timeout" },
            ],
          });
        if (failed) return json({ detail: "History unavailable" }, 503);
        return json(history(21));
      }),
    );
    render(<ForecastTracking />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "History unavailable",
    );
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload history" }));
    await screen.findByText("Alex Player");
    fireEvent.click(screen.getByRole("button", { name: "Older forecasts" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([path]) => String(path).includes("offset=20")),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Refresh results",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("NBA timeout"),
    );
    expect(screen.getByText("Alex Player")).toBeTruthy();
  });

  it("aborts pending history requests when leaving the view", () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = render(<ForecastTracking />);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
