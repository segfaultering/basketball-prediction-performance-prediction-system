import { useCallback, useEffect, useMemo, useState } from "react";
import { initialDate, parseSeasons, seasonFor } from "./api";
import type { Backtest, Game, Player, Prediction } from "./api";
import { useApi } from "./ApiContext";
import { errorText, useRequest } from "./useRequest";

export type PredictionWorkflow = ReturnType<typeof usePredictionWorkflow>;
export function usePredictionWorkflow() {
  const api = useApi();
  const [date, setDate] = useState(() => initialDate(api.mode));
  const [refresh, setRefresh] = useState(0);
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState("");
  const [gamesBusy, setGamesBusy] = useState(true);
  const [gamesError, setGamesError] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [playersBusy, setPlayersBusy] = useState(false);
  const [playersError, setPlayersError] = useState("");
  const [rosterRefresh, setRosterRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [override, setOverride] = useState(false);
  const [minutes, setMinutes] = useState(32);
  const [seasons, setSeasons] = useState("");
  const {
    data: result,
    busy: predictionBusy,
    error: predictionError,
    run: runPrediction,
    reset: clearPrediction,
  } = useRequest<Prediction>();
  const {
    data: backtest,
    busy: backtestBusy,
    error: backtestError,
    run: runBacktest,
    reset: clearBacktest,
  } = useRequest<Backtest>({ keepDataOnRun: true });
  const game = useMemo(
    () => games.find((g) => g.game_id === gameId),
    [games, gameId],
  );
  const player = players.find((p) => String(p.PLAYER_ID) === playerId);
  const filteredPlayers = players.filter(
    (p) =>
      (teamFilter === "all" || p.team === teamFilter) &&
      `${p.PLAYER} ${p.team}`.toLowerCase().includes(search.toLowerCase()),
  );

  const resetPrediction = useCallback(() => {
    clearPrediction();
    clearBacktest();
  }, [clearPrediction, clearBacktest]);

  useEffect(() => {
    const controller = new AbortController();
    setGamesBusy(true);
    setGamesError("");
    setGames([]);
    setGameId("");
    setPlayers([]);
    setPlayerId("");
    resetPrediction();
    api
      .games(date, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setGames(data.games);
          setGameId(data.games[0]?.game_id || "");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setGamesError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGamesBusy(false);
      });
    return () => controller.abort();
  }, [api, date, refresh, resetPrediction]);

  useEffect(() => {
    const controller = new AbortController();
    setPlayers([]);
    setPlayerId("");
    setPlayersError("");
    setSearch("");
    setTeamFilter("all");
    resetPrediction();
    if (!game) {
      setPlayersBusy(false);
      return () => controller.abort();
    }
    setPlayersBusy(true);
    Promise.all([
      api
        .players(game.away_team_id, seasonFor(game.date), controller.signal)
        .then((data) =>
          data.players.map((p) => ({ ...p, team: game.away_team })),
        ),
      api
        .players(game.home_team_id, seasonFor(game.date), controller.signal)
        .then((data) =>
          data.players.map((p) => ({ ...p, team: game.home_team })),
        ),
    ])
      .then((data) => {
        if (!controller.signal.aborted) setPlayers(data.flat());
      })
      .catch((e) => {
        if (!controller.signal.aborted) setPlayersError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlayersBusy(false);
      });
    return () => controller.abort();
  }, [api, game, rosterRefresh, resetPrediction]);

  useEffect(() => {
    resetPrediction();
  }, [playerId, override, minutes, seasons, resetPrediction]);
  async function predict() {
    if (!game || !player) return;
    await runPrediction((signal) =>
      api.predict(
        {
          player_id: playerId,
          game_id: gameId,
          seasons: parseSeasons(seasons),
          ...(override ? { minutes } : {}),
        },
        signal,
      ),
    );
  }
  async function evaluate() {
    if (!player) return;
    await runBacktest((signal) =>
      api.backtest(
        {
          player_id: playerId,
          seasons: parseSeasons(seasons),
        },
        signal,
      ),
    );
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `prediction-${result.player_id}-${result.game_date}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return {
    date,
    setDate,
    refresh,
    setRefresh,
    game,
    games,
    gameId,
    setGameId,
    gamesBusy,
    gamesError,
    players,
    player,
    playerId,
    setPlayerId,
    filteredPlayers,
    playersBusy,
    playersError,
    setRosterRefresh,
    search,
    setSearch,
    teamFilter,
    setTeamFilter,
    override,
    setOverride,
    minutes,
    setMinutes,
    seasons,
    setSeasons,
    result,
    predictionBusy,
    predictionError,
    backtest,
    backtestBusy,
    backtestError,
    predict,
    evaluate,
    download,
  };
}
