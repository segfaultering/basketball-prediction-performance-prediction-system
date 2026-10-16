import { jsonResponse as json, makePrediction } from "./testFixtures";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import DailyForecasts from "./DailyForecasts";
import { statRecord } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const game = {
  game_id: "g1",
  date: "2026-10-20",
  status: 1,
  home_team: "BOS",
  away_team: "LAL",
  home_team_id: "2",
  away_team_id: "1",
};
const forecast = (id: string) =>
  makePrediction({
    player_id: id,
    projected_minutes: 30,
    last_history_date: "2026-10-18",
    model: {
      status: "trained",
      cache_hit: false,
      stats: {},
      trained_through: "2026-10-18",
    },
    warnings: ["Recent role uncertainty"],
    saved_at: "2026-10-20T12:00:00Z",
    stats: statRecord(() => ({
      prediction: id === "a" ? 25 : 18,
      approximate_80pct_range: [10, 30],
    })),
  });

it("selects across teams, keeps successful forecasts, retries failures and filters results", async () => {
  const user = userEvent.setup();
  let fail = true;
  const predictions: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path.startsWith("/games"))
        return json({ games: [game], stub_mode: true });
      if (path.startsWith("/teams/1/"))
        return json({ players: [{ PLAYER_ID: "a", PLAYER: "Alice" }] });
      if (path.startsWith("/teams/2/"))
        return json({ players: [{ PLAYER_ID: "b", PLAYER: "Bob" }] });
      const body = JSON.parse(String(options?.body));
      predictions.push(body.player_id);
      expect(body.game_id).toBe("g1");
      if (body.player_id === "b" && fail)
        return json({ detail: "Insufficient history" }, 422);
      return json(forecast(body.player_id));
    }),
  );
  render(<DailyForecasts />);
  await user.click(await screen.findByRole("checkbox", { name: /Alice/ }));
  await user.click(screen.getByRole("checkbox", { name: /Bob/ }));
  await user.click(
    screen.getByRole("button", { name: "Generate selected forecasts (2)" }),
  );
  await screen.findByText("Batch finished: 2 of 2 players processed.");
  expect(screen.getByRole("alert").textContent).toBe("Insufficient history");
  expect(predictions).toEqual(["a", "b"]);
  fail = false;
  await user.click(
    screen.getByRole("button", { name: "Generate selected forecasts (1)" }),
  );
  await screen.findByText("Batch finished: 1 of 1 players processed.");
  expect(predictions).toEqual(["a", "b", "b"]);
  expect(screen.queryByRole("alert")).toBeNull();
  await user.selectOptions(screen.getByLabelText("Team"), "BOS");
  const table = screen.getByRole("table");
  expect(within(table).queryByText("Alice")).toBeNull();
  expect(within(table).getByText("Bob")).toBeTruthy();
  await user.click(screen.getByText("Forecast details"));
  expect(screen.getByText("Recent role uncertainty")).toBeTruthy();
});

it("retains other rosters on partial failure and clears selections when the date changes", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      if (path.includes("date=2026-10-21"))
        return json({ games: [], stub_mode: false });
      if (path.startsWith("/games"))
        return json({ games: [game], stub_mode: false });
      if (path.startsWith("/teams/1/"))
        return json({ players: [{ PLAYER_ID: "a", PLAYER: "Alice" }] });
      return json({ detail: "Roster unavailable" }, 502);
    }),
  );
  render(<DailyForecasts />);
  await user.click(await screen.findByRole("checkbox", { name: /Alice/ }));
  expect(screen.getByRole("alert").textContent).toBe("BOS: Roster unavailable");
  fireEvent.change(screen.getByLabelText("Forecast date (UTC)"), {
    target: { value: "2026-10-21" },
  });
  await screen.findByText("No scheduled games for this date.");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("stops after the in-flight forecast and leaves remaining players available", async () => {
  const user = userEvent.setup();
  let finish: (value: Response) => void = () => {};
  const predictions: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path.startsWith("/games"))
        return json({ games: [game], stub_mode: false });
      if (path.startsWith("/teams/"))
        return json({
          players: [
            {
              PLAYER_ID: path.includes("/1/") ? "a" : "b",
              PLAYER: path.includes("/1/") ? "Alice" : "Bob",
            },
          ],
        });
      predictions.push(JSON.parse(String(options?.body)).player_id);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  render(<DailyForecasts />);
  await user.click(
    await screen.findByRole("button", { name: "Select visible players" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Generate selected forecasts (2)" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Stop after current player" }),
  );
  finish(await json(forecast("a")));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Generate selected forecasts (1)" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(predictions).toEqual(["a"]);
});
