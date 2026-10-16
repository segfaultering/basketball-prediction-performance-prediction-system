import {
  visitorRecords,
  persistVisitorRecords,
  visitorHistory,
  saveVisitorForecast,
} from "./visitorHistory";
import type {
  Backtest,
  Game,
  MinuteScenario,
  Player,
  Prediction,
  PredictionInput,
  TrackedForecast,
} from "./types";

interface Snapshot {
  version: number;
  date: string;
  games: Game[];
  rosters: Record<string, Omit<Player, "team">[]>;
  predictions: Record<
    string,
    {
      default: Prediction;
      scenarios: Record<
        string,
        Pick<Prediction, "stats" | "baseline" | "projected_minutes">
      >;
    }
  >;
  backtests: Record<string, Backtest>;
  outcomes: Record<string, NonNullable<TrackedForecast["outcome"]>>;
}

export interface ReplayReport {
  player: Player;
  prediction: Prediction;
  scenarios: MinuteScenario[];
  outcome: NonNullable<TrackedForecast["outcome"]>;
}

// A read-only preview never creates a saved forecast or changes its inputs.
export async function loadReplayReports(
  signal: AbortSignal,
): Promise<ReplayReport[]> {
  signal.throwIfAborted();
  const data = await snapshot();
  signal.throwIfAborted();
  const players = data.games.flatMap((game) => [
    ...(data.rosters[game.home_team_id] ?? []),
    ...(data.rosters[game.away_team_id] ?? []),
  ]);
  return structuredClone(
    players.flatMap((player) => {
      const prepared = data.predictions[String(player.PLAYER_ID)];
      const outcome = data.outcomes[String(player.PLAYER_ID)];
      if (!prepared || !outcome) return [];
      return [
        {
          player: { ...player, team: prepared.default.team },
          prediction: prepared.default,
          scenarios: Object.values(prepared.scenarios),
          outcome,
        },
      ];
    }),
  );
}
let snapshotPromise: Promise<Snapshot> | undefined;
async function snapshot(): Promise<Snapshot> {
  if (!snapshotPromise) {
    snapshotPromise = fetch(`${import.meta.env.BASE_URL}replay/snapshot.json`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "The NBA replay snapshot could not be loaded. Reload to try again.",
          );
        const data: Snapshot = await response.json();
        if (data.version !== 1)
          throw new Error("Unsupported NBA replay snapshot.");
        return data;
      })
      .catch((error: unknown) => {
        snapshotPromise = undefined;
        throw error;
      });
  }
  return snapshotPromise;
}

export async function historyRequest<T>(
  mode: "replay" | "live",
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const url = new URL(path, "https://courtside.local");
  if (url.pathname === "/forecasts/refresh") {
    if (mode === "live")
      throw new Error(
        "Live result refresh is not available in this public demo. Use NBA replay to explore completed results.",
      );
    const data = await snapshot();
    signal?.throwIfAborted();
    // Read after the network wait so newer saved scenarios are preserved.
    const items = visitorRecords(mode);
    for (const item of items) {
      const outcome = data.outcomes[item.prediction.player_id];
      if (outcome?.game_id === item.prediction.game_id) {
        item.outcome = structuredClone(outcome);
        item.updated_at = new Date().toISOString();
      }
    }
    persistVisitorRecords(mode, items);
    return {
      updated_forecasts: items.filter((r) => r.outcome).length,
      errors: [],
    } as T;
  }
  return visitorHistory(mode, path) as T;
}

export async function replayRequest<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  signal?.throwIfAborted();
  const data = await snapshot();
  signal?.throwIfAborted();
  const url = new URL(path, "https://courtside.local");
  if (url.pathname === "/health")
    return { status: "ok", stub_mode: false, replay_mode: true } as T;
  if (url.pathname === "/games")
    return {
      stub_mode: false,
      replay_mode: true,
      games: url.searchParams.get("date") === data.date ? data.games : [],
    } as T;
  const roster = /^\/teams\/([^/]+)\/players$/.exec(url.pathname);
  if (roster)
    return { stub_mode: false, players: data.rosters[roster[1]] || [] } as T;
  if (url.pathname.startsWith("/forecasts")) {
    const result = await historyRequest<T>("replay", path, signal);
    signal?.throwIfAborted();
    return result;
  }
  const input = body as PredictionInput | undefined;
  const prepared = input && data.predictions[input.player_id];
  if (!input || !prepared)
    throw new Error("Choose a featured player from the replay slate.");
  if (input.seasons?.length)
    throw new Error(
      "Replay uses a fixed history snapshot. Switch to Live NBA for custom history seasons.",
    );
  if (url.pathname === "/backtests")
    return structuredClone(data.backtests[input.player_id]) as T;
  if (
    url.pathname !== "/predictions" &&
    url.pathname !== "/predictions/scenarios"
  )
    throw new Error("This action is not available in NBA replay.");
  if (input.game_id !== prepared.default.game_id)
    throw new Error("Player is not in this replay matchup.");
  if (url.pathname === "/predictions/scenarios") {
    return structuredClone({
      reference: {
        projected_minutes: prepared.default.projected_minutes,
        stats: prepared.default.stats,
      },
      scenarios: Object.values(prepared.scenarios).sort(
        (a, b) => a.projected_minutes - b.projected_minutes,
      ),
    }) as T;
  }
  const prediction = structuredClone(prepared.default);
  if (input.minutes !== undefined) {
    const scenario = prepared.scenarios[String(input.minutes)];
    if (!scenario)
      throw new Error("Choose a whole number of minutes between 0 and 48.");
    Object.assign(prediction, structuredClone(scenario));
  }
  // Keep the prepared JSON immutable: no scenario or session can overwrite it.
  return saveVisitorForecast("replay", input, prediction) as T;
}
