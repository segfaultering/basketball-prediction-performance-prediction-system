import rawSnapshot from "../public/replay/snapshot.json?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request, setDataMode } from "./api";
import type { ForecastHistory, Prediction } from "./api";

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
