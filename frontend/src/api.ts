import { utcToday } from "./format";
import { httpRequest } from "./transport";
import type {
  DataMode,
  PredictionInput,
  Prediction,
  Game,
  Player,
  MinuteScenarios,
  Backtest,
  ForecastHistory,
  ForecastRefresh,
} from "./types";
export * from "./types";
export * from "./format";
export { apiBase } from "./transport";

export const portfolioEnabled = import.meta.env.VITE_PORTFOLIO_DEMO === "1";
let dataMode: DataMode = portfolioEnabled ? "replay" : "server";
export const getDataMode = () => dataMode;
export const setDataMode = (mode: DataMode) => {
  dataMode = mode;
};
export const initialDate = (mode: DataMode = dataMode) =>
  mode === "replay" ? "2025-03-08" : utcToday();
export async function requestForMode<T>(
  mode: DataMode,
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  signal?.throwIfAborted();
  if (mode === "replay") {
    const { replayRequest } = await import("./portfolio");
    return replayRequest<T>(path, signal, body);
  }
  if (mode === "live" && path.startsWith("/forecasts")) {
    const { historyRequest } = await import("./portfolio");
    return historyRequest<T>(mode, path, signal);
  }
  const result = await httpRequest<T>(mode, path, signal, body);
  if (mode === "live" && path === "/predictions") {
    const { saveVisitorForecast } = await import("./visitorHistory");
    signal?.throwIfAborted();
    return saveVisitorForecast(
      mode,
      body as PredictionInput,
      result as Prediction,
    ) as T;
  }
  return result;
}

export function request<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  return requestForMode<T>(dataMode, path, signal, body);
}

export function createClient(mode: DataMode) {
  return {
    mode,
    health: (signal?: AbortSignal) =>
      requestForMode<{ stub_mode: boolean }>(mode, "/health", signal),
    games: (date: string, signal?: AbortSignal) =>
      requestForMode<{ games: Game[]; stub_mode: boolean }>(
        mode,
        `/games?date=${date}`,
        signal,
      ),
    players: (team: string, season: string, signal?: AbortSignal) =>
      requestForMode<{ players: Omit<Player, "team">[] }>(
        mode,
        `/teams/${team}/players?season=${season}`,
        signal,
      ),
    predict: (input: PredictionInput, signal?: AbortSignal) =>
      requestForMode<Prediction>(mode, "/predictions", signal, input),
    scenarios: (
      input: Omit<PredictionInput, "minutes">,
      signal?: AbortSignal,
    ) =>
      requestForMode<MinuteScenarios>(
        mode,
        "/predictions/scenarios",
        signal,
        input,
      ),
    backtest: (
      input: Pick<PredictionInput, "player_id" | "seasons">,
      signal?: AbortSignal,
    ) => requestForMode<Backtest>(mode, "/backtests", signal, input),
    history: (limit: number, offset: number, signal?: AbortSignal) =>
      requestForMode<ForecastHistory>(
        mode,
        `/forecasts?limit=${limit}&offset=${offset}`,
        signal,
      ),
    refreshResults: (signal?: AbortSignal) =>
      requestForMode<ForecastRefresh>(mode, "/forecasts/refresh", signal, {}),
  };
}
export type PredictionClient = ReturnType<typeof createClient>;
