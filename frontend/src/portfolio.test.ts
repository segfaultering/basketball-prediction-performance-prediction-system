import rawSnapshot from "../public/replay/snapshot.json?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request, setDataMode } from "./api";
import type { ForecastHistory, Prediction } from "./api";
import { loadReplayReports } from "./portfolio";

const snapshot = JSON.parse(rawSnapshot);
beforeEach(() => {
  localStorage.clear();
  setDataMode("replay");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(snapshot))),
  );
});
afterEach(() => {
  setDataMode("server");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("uses prepared real predictions offline, preserves scenarios and separates live history", async () => {
  const input = { player_id: "201939", game_id: "0022400919", minutes: 32 };
  const prediction = await request<Prediction>(
    "/predictions",
    undefined,
    input,
  );
  expect(prediction.replay_mode).toBe(true);
  expect(prediction.projected_minutes).toBe(32);
  expect(prediction.stats).toEqual(
    snapshot.predictions["201939"].scenarios["32"].stats,
  );
  expect(prediction.forecast_id).toMatch(/^replay-/);
  prediction.stats.points.prediction = 999;
  const again = await request<Prediction>("/predictions", undefined, input);
  expect(again.stats.points.prediction).not.toBe(999);
  await request("/forecasts/refresh", undefined, {});
  const history = await request<ForecastHistory>("/forecasts");
  expect(history.summary.evaluated_games).toBe(1);
  expect(history.forecasts.filter((r) => r.primary)).toHaveLength(1);
  expect(history.forecasts[0].outcome?.stats).toEqual(
    snapshot.outcomes["201939"].stats,
  );
  setDataMode("live");
  expect((await request<ForecastHistory>("/forecasts")).total).toBe(0);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) =>
        String(url).endsWith("replay/snapshot.json"),
      ),
  ).toBe(true);
});

it("rejects incompatible matchups, history overrides, and fractional minutes", async () => {
  await expect(
    request("/predictions", undefined, {
      player_id: "201939",
      game_id: "wrong",
    }),
  ).rejects.toThrow("not in this replay matchup");
  await expect(
    request("/predictions", undefined, {
      player_id: "201939",
      game_id: "0022400919",
      minutes: 32.5,
    }),
  ).rejects.toThrow("whole number");
  await expect(
    request("/backtests", undefined, {
      player_id: "201939",
      seasons: ["2024-25"],
    }),
  ).rejects.toThrow("fixed history");
});

it("loads every minutes scenario without creating visitor history", async () => {
  const result = await request<import("./api").MinuteScenarios>(
    "/predictions/scenarios",
    undefined,
    { player_id: "201939", game_id: "0022400919" },
  );
  expect(result.scenarios.map((s) => s.projected_minutes)).toEqual(
    Array.from({ length: 49 }, (_, m) => m),
  );
  expect(result.scenarios[0].stats.points.prediction).toBe(0);
  expect(result.scenarios[48].stats).toEqual(
    snapshot.predictions["201939"].scenarios["48"].stats,
  );
  expect((await request<ForecastHistory>("/forecasts")).total).toBe(0);
});

it("keeps scouting previews isolated from saved forecasts and the prepared snapshot", async () => {
  const reports = await loadReplayReports(new AbortController().signal);
  expect(reports).toHaveLength(6);
  const curry = reports.find(
    (report) => report.prediction.player_id === "201939",
  )!;
  expect(curry.player.PLAYER).toBe("Stephen Curry");
  expect(curry.player.team).toBe("GSW");
  expect(curry.outcome.stats.points).toBe(32);
  expect(curry.scenarios).toHaveLength(49);
  expect(
    reports.find((report) => report.player.PLAYER === "T.J. McConnell")?.outcome
      .minutes,
  ).toBe(0);
  curry.prediction.stats.points.prediction = 999;
  curry.scenarios[0].stats.points.prediction = 999;
  curry.outcome.stats.points = 999;
  const again = await loadReplayReports(new AbortController().signal);
  const untouched = again.find(
    (report) => report.prediction.player_id === "201939",
  )!;
  expect(untouched.prediction.stats.points.prediction).toBe(
    snapshot.predictions["201939"].default.stats.points.prediction,
  );
  expect(
    untouched.scenarios.find((item) => item.projected_minutes === 0)?.stats
      .points.prediction,
  ).toBe(0);
  expect(untouched.outcome.stats.points).toBe(32);
  expect((await request<ForecastHistory>("/forecasts")).total).toBe(0);
});

it("does not save an aborted replay request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    request("/predictions", controller.signal, {
      player_id: "201939",
      game_id: "0022400919",
    }),
  ).rejects.toThrow();
  const before = localStorage.getItem("courtside:replay:history:v1");
  expect(before).toBeNull();
});

it("keeps this session usable when localStorage writes fail", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage denied");
  });
  const result = await request<Prediction>("/predictions", undefined, {
    player_id: "1630595",
    game_id: "0022400919",
  });
  expect(result.warnings.join(" ")).toContain("only for this session");
  expect(
    (await request<ForecastHistory>("/forecasts")).forecasts.some(
      (r) => r.prediction.player_id === "1630595",
    ),
  ).toBe(true);
});
