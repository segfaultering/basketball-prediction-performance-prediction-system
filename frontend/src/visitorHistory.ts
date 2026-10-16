import { STATS, statRecord } from "./types";
import type {
  ForecastHistory,
  Prediction,
  PredictionInput,
  TrackedForecast,
} from "./types";

const memory: Record<"replay" | "live", TrackedForecast[]> = {
  replay: [],
  live: [],
};
const storageFailed = { replay: false, live: false };
const storageKey = (mode: string) => `courtside:${mode}:history:v1`;

export function visitorRecords(mode: "replay" | "live"): TrackedForecast[] {
  if (storageFailed[mode]) return structuredClone(memory[mode]);
  try {
    const saved = localStorage.getItem(storageKey(mode));
    let parsed: unknown;
    try {
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      parsed = [];
    }
    // A damaged entry must not hide the other valid scenarios or crash rendering.
    memory[mode] = Array.isArray(parsed)
      ? parsed.filter(validRecord).slice(-100)
      : [];
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
    Number.isFinite(Date.parse(r.created_at)) &&
    !!r.inputs &&
    typeof r.inputs.player_id === "string" &&
    typeof r.inputs.game_id === "string" &&
    typeof r.inputs.season_type === "string" &&
    !!r.prediction &&
    typeof r.prediction.player_id === "string" &&
    typeof r.prediction.game_id === "string" &&
    typeof r.prediction.game_date === "string" &&
    Number.isFinite(Date.parse(r.prediction.game_date)) &&
    typeof r.prediction.team === "string" &&
    typeof r.prediction.opponent === "string" &&
    (r.prediction.player_name === undefined ||
      typeof r.prediction.player_name === "string") &&
    Number.isFinite(r.prediction.projected_minutes) &&
    !!r.prediction.stats &&
    !!r.prediction.baseline?.stats &&
    STATS.every(
      (stat) =>
        Number.isFinite(r.prediction.stats[stat]?.prediction) &&
        Number.isFinite(r.prediction.baseline.stats[stat]) &&
        Array.isArray(r.prediction.stats[stat].approximate_80pct_range) &&
        r.prediction.stats[stat].approximate_80pct_range.length === 2 &&
        r.prediction.stats[stat].approximate_80pct_range.every(
          Number.isFinite,
        ) &&
        r.prediction.stats[stat].approximate_80pct_range[0] <=
          r.prediction.stats[stat].approximate_80pct_range[1],
    ) &&
    (r.outcome === null ||
      (!!r.outcome &&
        Number.isFinite(r.outcome.minutes) &&
        r.outcome.minutes >= 0 &&
        (r.outcome.game_id === undefined ||
          r.outcome.game_id === r.prediction.game_id) &&
        STATS.every((s) => Number.isFinite(r.outcome?.stats?.[s]))))
  );
}

export function persistVisitorRecords(
  mode: "replay" | "live",
  items: TrackedForecast[],
): boolean {
  memory[mode] = structuredClone(items.slice(-100));
  // Once storage fails, memory stays authoritative for the rest of this session.
  if (storageFailed[mode]) return false;
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
  const items = visitorRecords(mode);
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
  if (!persistVisitorRecords(mode, items))
    saved.warnings.push(
      "Browser storage is unavailable; history will last only for this session.",
    );
  return saved;
}

export function visitorHistory(
  mode: "replay" | "live",
  path: string,
): ForecastHistory {
  const url = new URL(path, "https://courtside.local");
  const items = visitorRecords(mode);
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
        ? statRecord(
            (stat) =>
              item.prediction.stats[stat].prediction -
              item.outcome!.stats[stat],
          )
        : null;
  }
  const evaluated = items.filter((r) => r.primary && r.status === "settled");
  const primary = items.filter((r) => r.primary);
  const stats = statRecord((s) => {
    const errors = evaluated.map(
      (r) => r.prediction.stats[s].prediction - r.outcome!.stats[s],
    );
    const baseline = evaluated.map(
      (r) => r.prediction.baseline.stats[s] - r.outcome!.stats[s],
    );
    const count = evaluated.length;
    return {
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
    };
  });
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
  };
}
