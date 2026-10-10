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

export async function request<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  const response = await fetch(path, {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
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
  return response.json() as Promise<T>;
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
