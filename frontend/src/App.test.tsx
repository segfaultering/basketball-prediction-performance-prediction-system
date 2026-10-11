import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { STATS, utcToday } from "./api";
import type { Prediction } from "./api";

const forecast: Prediction = {
  forecast_id: "saved-forecast",
  player_id: "1",
  game_id: "game",
  game_date: utcToday(),
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
  ) as Prediction["stats"],
  baseline: {
    stats: Object.fromEntries(
      STATS.map((s) => [s, 18]),
    ) as Prediction["baseline"]["stats"],
    parameters: {},
  },
  model: {
    status: "trained",
    cache_hit: false,
    trained_through: "2026-01-01",
    stats: {
      points: {
        active: true,
        baseline_mae: 8,
        model_mae: 7,
        baseline: { window: "career", kind: "blend", value: 0.5 },
      },
    },
    evaluation: { validation_games: 20 },
  },
};
const game = {
  game_id: "game",
  date: utcToday(),
  status: 1,
  home_team: "LAL",
  away_team: "BOS",
  home_team_id: "lal",
  away_team_id: "bos",
};
let predictionHandler: (init?: RequestInit) => Promise<Response>;
let scenarioHandler: (init?: RequestInit) => Promise<Response>;
const json = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  predictionHandler = () => json(forecast);
  scenarioHandler = () =>
    json({
      reference: forecast,
      scenarios: Array.from({ length: 49 }, (_, minutes) => ({
        projected_minutes: minutes,
        stats: Object.fromEntries(
          STATS.map((s) => [
            s,
            {
              prediction: minutes,
              approximate_80pct_range: [minutes * 0.5, minutes * 1.5],
            },
          ]),
        ),
      })),
    });
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (path === "/health") return json({ stub_mode: true });
      if (path.startsWith("/games")) return json({ games: [game] });
      if (path.startsWith("/teams/lal"))
        return json({
          players: [{ PLAYER_ID: "1", PLAYER: "Alex Player", POSITION: "G" }],
        });
      if (path.startsWith("/teams/bos"))
        return json({
          players: [{ PLAYER_ID: "2", PLAYER: "Sam Player", POSITION: "F" }],
        });
      if (path === "/predictions") return predictionHandler(init);
      if (path === "/predictions/scenarios") return scenarioHandler(init);
      return json({ detail: "Unexpected request" }, 500);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function selectPlayer() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole(
      "button",
      { name: /Alex Player/ },
      { timeout: 5000 },
    ),
  );
  return user;
}

describe("prediction workflow", () => {
  it("explores minutes locally without saving or changing the current forecast", async () => {
    const user = await selectPlayer();
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Explore minutes" }),
    );
    const slider = await screen.findByRole("slider", {
      name: /Scenario minutes/,
    });
    fireEvent.change(slider, { target: { value: "0" } });
    expect(
      screen
        .getByRole("img", { name: /Points forecast by minutes/ })
        .getAttribute("aria-label"),
    ).toContain("At 0 minutes: 0.0");
    fireEvent.change(slider, { target: { value: "48" } });
    await user.selectOptions(
      screen.getByLabelText("Chart statistic"),
      "assists",
    );
    expect(
      screen
        .getByRole("img", { name: /Assists forecast by minutes/ })
        .getAttribute("aria-label"),
    ).toContain("At 48 minutes: 48.0");
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.filter(([path]) => path === "/predictions"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => path === "/predictions/scenarios"),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Close explorer" }));
    await user.click(screen.getByRole("button", { name: "Explore minutes" }));
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => path === "/predictions/scenarios"),
    ).toHaveLength(1);
  });

  it("retries failed scenarios and aborts exploration when the player changes", async () => {
    const user = await selectPlayer();
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    scenarioHandler = () => json({ detail: "Scenarios unavailable" }, 503);
    await user.click(
      await screen.findByRole("button", { name: "Explore minutes" }),
    );
    expect(await screen.findByText("Scenarios unavailable")).toBeTruthy();
    let signal: AbortSignal | null | undefined;
    let resolve: (response: Response) => void = () => {};
    scenarioHandler = (init) => {
      signal = init?.signal;
      return new Promise((res) => {
        resolve = res;
      });
    };
    await user.click(screen.getByRole("button", { name: "Retry scenarios" }));
    await user.click(screen.getByRole("button", { name: /Sam Player/ }));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve(await json({ reference: forecast, scenarios: [] }));
    });
    expect(
      screen.queryByRole("slider", { name: /Scenario minutes/ }),
    ).toBeNull();
  });

  it("requests automatic career history and displays baseline plus validation", async () => {
    const user = await selectPlayer();
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    await screen.findByText("100");
    expect(screen.getByText("Saved")).toBeTruthy();
    const calls = vi.mocked(fetch).mock.calls;
    const input = JSON.parse(
      String(calls.find(([path]) => path === "/predictions")?.[1]?.body),
    );
    expect(input).toEqual({ player_id: "1", game_id: "game" });
    expect(screen.getAllByText("18.0").length).toBe(3);
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Navigation" })).getByRole(
        "button",
        { name: "Model insights" },
      ),
    );
    expect(screen.getByText("7.0")).toBeTruthy();
    expect(
      within(screen.getByRole("table")).getByText("Correction"),
    ).toBeTruthy();
  });

  it("sends minutes override and clears results when playing time changes", async () => {
    const user = await selectPlayer();
    await user.click(
      screen.getByRole("checkbox", { name: "Set expected minutes" }),
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "28" } });
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    await screen.findByText("100");
    const init = vi
      .mocked(fetch)
      .mock.calls.find(([path]) => path === "/predictions")?.[1];
    expect(JSON.parse(String(init?.body)).minutes).toBe(28);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "30" } });
    await waitFor(() => expect(screen.queryByText("100")).toBeNull());
  });

  it("cancels a pending prediction and ignores its stale response after player changes", async () => {
    let resolve: (response: Response) => void = () => {};
    let signal: AbortSignal | null | undefined;
    predictionHandler = (init) => {
      signal = init?.signal;
      return new Promise((res) => {
        resolve = res;
      });
    };
    const user = await selectPlayer();
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    await user.click(screen.getByRole("button", { name: /Sam Player/ }));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve(await json(forecast));
    });
    expect(screen.queryByText("100")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: /Generate prediction/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows upstream prediction errors and validates season input before requesting", async () => {
    const user = await selectPlayer();
    predictionHandler = () =>
      json({ detail: "Player history unavailable" }, 502);
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Player history unavailable"),
    );
    await user.click(screen.getByText("History options"));
    await user.type(screen.getByLabelText("History seasons"), "wrong");
    await user.click(
      screen.getByRole("button", { name: /Generate prediction/ }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Enter up to five"),
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([path]) => path === "/predictions"),
    ).toHaveLength(1);
  });

  it("searches both rosters without selecting hidden players automatically", async () => {
    const user = await selectPlayer();
    await user.type(screen.getByLabelText("Search players"), "Sam");
    expect(screen.queryByRole("button", { name: /Alex Player/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sam Player/ })).toBeTruthy();
    await user.clear(screen.getByLabelText("Search players"));
    expect(
      screen
        .getByRole("button", { name: /Alex Player/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
