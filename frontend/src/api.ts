export type Stat = "points" | "rebounds" | "assists" | "steals" | "blocks";
export const STATS: Stat[] = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
];
export const LABELS: Record<Stat, string> = {
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  steals: "Steals",
  blocks: "Blocks",
};
export interface Game {
  replay_mode?: boolean;
  game_id: string;
  date: string;
  status: number;
  home_team: string;
  away_team: string;
  home_team_id: string;
  away_team_id: string;
  tipoff_utc?: string;
}
export interface Player {
  PLAYER_ID: number | string;
  PLAYER: string;
  POSITION?: string;
  team: string;
}
export interface ModelStat {
  active: boolean;
  baseline_mae?: number;
  model_mae?: number;
  baseline: { window: string; kind: string; value: number };
}
export interface Prediction {
  replay_mode?: boolean;
  forecast_id?: string;
  saved_at?: string;
  player_name?: string;
  player_id: string;
  game_id: string;
  game_date: string;
  team: string;
  opponent: string;
  home: boolean;
  projected_minutes: number;
  history_games: number;
  last_history_date: string;
  stub_mode: boolean;
  warnings: string[];
  stats: Record<
    Stat,
    {
      prediction: number;
      approximate_80pct_range: [number, number];
      model_correction?: number;
    }
  >;
  baseline: {
    stats: Record<Stat, number>;
    parameters: Partial<Record<Stat, ModelStat["baseline"]>>;
  };
  model: {
    status: string;
    cache_hit: boolean;
    trained_through: string;
    stats: Partial<Record<Stat, ModelStat>>;
    evaluation?: { validation_games: number };
  };
}
export interface Backtest {
  replay_mode?: boolean;
  evaluation_scope?: string;
  evaluated_games: number;
  stub_mode: boolean;
  stats: Record<
    Stat,
    {
      mae: number;
      rmse: number;
      blended_baseline_mae: number;
      last_10_mean_mae: number;
      range_coverage: number;
    }
  >;
}
export interface PredictionInput {
  player_id: string;
  game_id: string;
  minutes?: number;
  seasons?: string[];
}

export type MinuteScenario = Pick<Prediction, "projected_minutes" | "stats">;
export interface MinuteScenarios {
  reference: MinuteScenario;
  scenarios: MinuteScenario[];
}

export interface TrackedForecast {
  id: string;
  created_at: string;
  updated_at: string | null;
  primary: boolean;
  status: "pending" | "settled" | "did_not_play";
  inputs: {
    player_id: string;
    game_id: string;
    minutes: number | null;
    seasons: string[] | null;
    season_type: string;
  };
  prediction: Prediction;
  outcome: {
    game_id?: string;
    date?: string;
    minutes: number;
    stats: Record<Stat, number>;
  } | null;
  errors: Record<Stat, number> | null;
}
export interface ForecastHistory {
  replay_mode?: boolean;
  stub_mode: boolean;
  total: number;
  forecasts: TrackedForecast[];
  summary: {
    tracked_games: number;
    evaluated_games: number;
    pending_games: number;
    did_not_play_games: number;
    stats: Record<
      Stat,
      {
        mae: number | null;
        rmse: number | null;
        baseline_mae: number | null;
        range_coverage: number | null;
      }
    >;
  };
}
export interface ForecastRefresh {
  updated_forecasts: number;
  errors: { player_id: string; season: string; detail: string }[];
}

export type DataMode = "server" | "replay" | "live";
export const portfolioEnabled = import.meta.env.VITE_PORTFOLIO_DEMO === "1";
let dataMode: DataMode = portfolioEnabled ? "replay" : "server";
export const getDataMode = () => dataMode;
export const setDataMode = (mode: DataMode) => {
  dataMode = mode;
};
export const initialDate = () =>
  dataMode === "replay" ? "2025-03-08" : utcToday();
export const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/$/,
  "",
);

export async function request<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  const mode = dataMode;
  if (mode === "replay") {
    const { replayRequest } = await import("./portfolio");
    return replayRequest<T>(path, signal, body);
  }
  if (mode === "live" && path.startsWith("/forecasts")) {
    const { historyRequest } = await import("./portfolio");
    return historyRequest<T>(mode, path);
  }
  const deadline = mode === "live" ? AbortSignal.timeout(90_000) : undefined;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      signal: deadline
        ? signal
          ? AbortSignal.any([signal, deadline])
          : deadline
        : signal,
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch (error) {
    if (mode === "live" && !signal?.aborted)
      throw new Error(
        "Live data could not be reached. The API may be waking up; retry or switch to NBA replay.",
      );
    throw error;
  }
  if (!response.ok) {
    const retryHeader = response.headers.get("Retry-After");
    const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
    const wait =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds >= 60
          ? `about ${Math.ceil(retrySeconds / 60)} ${retrySeconds <= 60 ? "minute" : "minutes"}`
          : `about ${Math.ceil(retrySeconds)} ${retrySeconds <= 1 ? "second" : "seconds"}`
        : "a minute";
    if (response.status === 429)
      throw new Error(
        `Forecast limit reached. Please wait ${wait} before trying again. Your saved forecasts are still available.`,
      );
    if (response.status === 503 && retryHeader)
      throw new Error(
        `Forecast service is busy. Another forecast is being prepared. Please try again in ${Number.isFinite(retrySeconds) && retrySeconds > 0 ? wait : "a few seconds"}.`,
      );
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      /* Non-JSON upstream errors use the status below. */
    }
    if (Array.isArray(detail))
      detail = detail.map((item: { msg?: string }) => item.msg).join("; ");
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      mode === "live"
        ? "The live API is not ready. Retry shortly or switch to NBA replay."
        : "The API returned an invalid response. Please try again.",
    );
  }
  signal?.throwIfAborted();
  if (mode === "live" && path === "/predictions") {
    const { saveVisitorForecast } = await import("./portfolio");
    return saveVisitorForecast(mode, body as PredictionInput, result) as T;
  }
  return result as T;
}
export const utcToday = () => new Date().toISOString().slice(0, 10);
export function seasonFor(date: string) {
  const [year, month] = date.split("-").map(Number);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function prettyDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function tipoff(game: Game) {
  if (!game.tipoff_utc) return "Time to be confirmed";
  const date = new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(game.tipoff_utc)
      ? game.tipoff_utc
      : `${game.tipoff_utc}Z`,
  );
  return Number.isNaN(date.getTime())
    ? "Time to be confirmed"
    : `${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`;
}
