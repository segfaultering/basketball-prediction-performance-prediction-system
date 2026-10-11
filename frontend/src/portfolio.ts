import { STATS } from "./api";
import type {
  Backtest,
  Game,
  Player,
  Prediction,
  PredictionInput,
  TrackedForecast,
} from "./api";

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
let snapshotPromise: Promise<Snapshot> | undefined;
const memory: Record<"replay" | "live", TrackedForecast[]> = {
  replay: [],
  live: [],
};
const storageFailed = { replay: false, live: false };
const storageKey = (mode: string) => `courtside:${mode}:history:v1`;

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

function records(mode: "replay" | "live"): TrackedForecast[] {
  if (storageFailed[mode]) return structuredClone(memory[mode]);
  try {
    const saved = localStorage.getItem(storageKey(mode));
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (
        Array.isArray(parsed) &&
        parsed.length <= 100 &&
        parsed.every(validRecord)
      )
        memory[mode] = parsed;
    } else memory[mode] = [];
  } catch {
    storageFailed[mode] = true;
    /* Keep this session usable when browser storage is unavailable. */
  }
  return structuredClone(memory[mode]);
}

function validRecord(value: unknown): value is TrackedForecast {
  if (!value || typeof value !== "object") return false;
  const r = value as TrackedForecast;
  return (
    typeof r.id === "string" &&
    typeof r.created_at === "string" &&
    !!r.inputs &&
    typeof r.inputs.player_id === "string" &&
    !!r.prediction &&
    typeof r.prediction.player_id === "string" &&
    typeof r.prediction.game_id === "string" &&
    !!r.prediction.stats &&
    !!r.prediction.baseline?.stats &&
    STATS.every(
      (stat) =>
        Number.isFinite(r.prediction.stats[stat]?.prediction) &&
        Number.isFinite(r.prediction.baseline.stats[stat]) &&
        Array.isArray(r.prediction.stats[stat].approximate_80pct_range) &&
        r.prediction.stats[stat].approximate_80pct_range.length === 2 &&
        r.prediction.stats[stat].approximate_80pct_range.every(Number.isFinite),
    ) &&
    (r.outcome === null ||
      (!!r.outcome &&
        Number.isFinite(r.outcome.minutes) &&
        STATS.every((s) => Number.isFinite(r.outcome?.stats[s]))))
  );
}

function persist(mode: "replay" | "live", items: TrackedForecast[]): boolean {
  memory[mode] = structuredClone(items.slice(-100));
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify(memory[mode]));
    return true;
  } catch {
    storageFailed[mode] = true;
    return false;
  }
}

export function saveVisitorForecast(
  mode: "replay" | "live",
  input: PredictionInput,
  prediction: Prediction,
): Prediction {
  const saved = structuredClone(prediction);
  saved.forecast_id = `${mode}-${crypto.randomUUID()}`;
  saved.saved_at = new Date().toISOString();
  const items = records(mode);
  items.push({
    id: saved.forecast_id,
    created_at: saved.saved_at,
    updated_at: null,
    primary: false,
    status: "pending",
    prediction: saved,
    inputs: {
      player_id: input.player_id,
      game_id: input.game_id,
      minutes: input.minutes ?? null,
      seasons: input.seasons ?? null,
      season_type: "Regular Season",
    },
    outcome: null,
    errors: null,
  });
  if (!persist(mode, items))
    saved.warnings.push(
      "Browser storage is unavailable; history will last only for this session.",
    );
  return saved;
}

export async function historyRequest<T>(
  mode: "replay" | "live",
  path: string,
): Promise<T> {
  const url = new URL(path, "https://courtside.local");
  const items = records(mode);
  if (url.pathname === "/forecasts/refresh") {
    if (mode === "live")
      throw new Error(
        "Live result refresh is not available in this public demo. Use NBA replay to explore completed results.",
      );
    const data = await snapshot();
    for (const item of items) {
      const outcome = data.outcomes[item.prediction.player_id];
      if (outcome?.game_id === item.prediction.game_id) {
        item.outcome = structuredClone(outcome);
        item.updated_at = new Date().toISOString();
      }
    }
    persist(mode, items);
    return {
      updated_forecasts: items.filter((r) => r.outcome).length,
      errors: [],
    } as T;
  }
  const first = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify([
      item.prediction.player_id,
      item.prediction.game_id,
    ]);
    item.primary = !first.has(key);
    first.add(key);
    item.status = !item.outcome
      ? "pending"
      : item.outcome.minutes === 0
        ? "did_not_play"
        : "settled";
    item.errors =
      item.status === "settled"
        ? (Object.fromEntries(
            STATS.map((s) => [
              s,
              item.prediction.stats[s].prediction - item.outcome!.stats[s],
            ]),
          ) as TrackedForecast["errors"])
        : null;
  }
  const evaluated = items.filter((r) => r.primary && r.status === "settled");
  const primary = items.filter((r) => r.primary);
  const stats = Object.fromEntries(
    STATS.map((s) => {
      const errors = evaluated.map(
        (r) => r.prediction.stats[s].prediction - r.outcome!.stats[s],
      );
      const baseline = evaluated.map(
        (r) => r.prediction.baseline.stats[s] - r.outcome!.stats[s],
      );
      const count = evaluated.length;
      return [
        s,
        {
          mae: count
            ? errors.reduce((sum, e) => sum + Math.abs(e), 0) / count
            : null,
          rmse: count
            ? Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / count)
            : null,
          baseline_mae: count
            ? baseline.reduce((sum, e) => sum + Math.abs(e), 0) / count
            : null,
          range_coverage: count
            ? evaluated.filter(
                (r) =>
                  r.prediction.stats[s].approximate_80pct_range[0] <=
                    r.outcome!.stats[s] &&
                  r.outcome!.stats[s] <=
                    r.prediction.stats[s].approximate_80pct_range[1],
              ).length / count
            : null,
        },
      ];
    }),
  );
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") || 50) || 50),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
  return {
    stub_mode: false,
    replay_mode: mode === "replay",
    total: items.length,
    forecasts: [...items].reverse().slice(offset, offset + limit),
    summary: {
      tracked_games: primary.length,
      evaluated_games: evaluated.length,
      pending_games: primary.filter((r) => r.status === "pending").length,
      did_not_play_games: primary.filter((r) => r.status === "did_not_play")
        .length,
      stats,
    },
  } as T;
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
    const result = await historyRequest<T>("replay", path);
    signal?.throwIfAborted();
    return result;
  }
  if (url.pathname === "/player-research")
    throw new Error("Live news is not part of the historical replay.");
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
