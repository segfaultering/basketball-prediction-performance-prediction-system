import { statRecord } from "./types";
import type { Prediction } from "./types";

export function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export function makePrediction(
  overrides: Partial<Prediction> = {},
): Prediction {
  return {
    player_id: "1",
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
    stats: statRecord(() => ({
      prediction: 20,
      approximate_80pct_range: [10, 30],
    })),
    baseline: { stats: statRecord(() => 18), parameters: {} },
    model: {
      status: "trained",
      cache_hit: false,
      trained_through: "2026-01-01",
      stats: {},
    },
    ...overrides,
  };
}
