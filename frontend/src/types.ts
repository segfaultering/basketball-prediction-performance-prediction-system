export const STATS = [
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
] as const;
export type Stat = (typeof STATS)[number];
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
export const TARGET_STATS = ["points", "rebounds", "assists"] as const;
export const ABBREVIATIONS: Record<Stat, string> = {
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  steals: "STL",
  blocks: "BLK",
};

export function statRecord<T>(value: (stat: Stat) => T): Record<Stat, T> {
  return {
    points: value("points"),
    rebounds: value("rebounds"),
    assists: value("assists"),
    steals: value("steals"),
    blocks: value("blocks"),
  };
}
