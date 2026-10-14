import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForecastTracking from "./ForecastTracking";
import DailyForecasts from "./DailyForecasts";
import MinutesExplorer from "./MinutesExplorer";
import ModelAccuracy from "./ModelAccuracy";
import AccuracyGuide from "./AccuracyGuide";
import ThemeToggle from "./ThemeToggle";
import TeamBadge from "./TeamBadge";
import Sidebar from "./Sidebar";
import type { View } from "./Sidebar";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import {
  LABELS,
  STATS,
  prettyDate,
  request,
  seasonFor,
  shiftDate,
  tipoff,
  utcToday,
  initialDate,
  getDataMode,
  setDataMode,
  portfolioEnabled,
} from "./api";
import type {
  Backtest,
  Game,
  Player,
  Prediction,
  PredictionInput,
  Stat,
  DataMode,
} from "./api";

const TEAM_COLORS: Record<string, string> = {
  LAL: "#9162be",
  BOS: "#398b68",
  GSW: "#4770be",
  NYK: "#dc7449",
  MIA: "#be5362",
  CHI: "#bd4f55",
  DAL: "#527ca2",
  PHX: "#ba744e",
  MIL: "#5d8767",
};
const teamColor = (team: string) => TEAM_COLORS[team] || "#637992";
const number = (value: number) => value.toFixed(1);
const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function StepTitle({
  step,
  title,
  subtitle,
}: {
  step: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="step-title">
      <span className="step-number">{step}</span>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}
function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const title = message.startsWith("Forecast limit reached.")
    ? "Forecast limit reached"
    : message.startsWith("Forecast service is busy.")
      ? "Forecast service is busy"
      : "";
  return (
    <div className="error-notice" role="alert">
      <Info size={17} />
      <span>
        {title ? (
          <>
            <strong>{title}</strong>
            <span className="error-description">
              {message.slice(title.length + 1).trim()}
            </span>
          </>
        ) : (
          message
        )}
      </span>
      {retry && (
        <button onClick={retry}>
          Try again <RefreshCw size={13} />
        </button>
      )}
    </div>
  );
}
function parseSeasons(value: string) {
  const seasons = [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (
    seasons.length > 5 ||
    seasons.some(
      (s) =>
        !/^\d{4}-\d{2}$/.test(s) ||
        (Number(s.slice(0, 4)) + 1) % 100 !== Number(s.slice(-2)),
    )
  ) {
    throw new Error(
      "Enter up to five consecutive-year seasons, such as 2024-25, 2025-26.",
    );
  }
  return seasons.length ? seasons : undefined;
}

function StatCard({ stat, result }: { stat: Stat; result: Prediction | null }) {
  const estimate = result?.stats[stat];
  const baseline = result?.baseline.stats[stat];
  const difference =
    estimate && baseline !== undefined ? estimate.prediction - baseline : 0;
  const active = result?.model.stats[stat]?.active;
  const [low, high] = estimate?.approximate_80pct_range || [0, 0];
  const scale =
    Math.max(high, estimate?.prediction || 0, baseline || 0, 1) * 1.1;
  return (
    <article className={`stat-card ${stat === "points" ? "featured" : ""}`}>
      <div className="stat-top">
        <span>{LABELS[stat]}</span>
        <span className="stat-abbreviation">
          {
            {
              points: "PTS",
              rebounds: "REB",
              assists: "AST",
              steals: "STL",
              blocks: "BLK",
            }[stat]
          }
        </span>
      </div>
      <div className={`stat-value ${!estimate ? "empty" : ""}`}>
        {estimate ? number(estimate.prediction) : "—"}
        <span>projected</span>
      </div>
      <div className="stat-range">
        {estimate ? (
          <>
            <span>
              {number(low)} – {number(high)}
            </span>{" "}
            80% range (approx.)
          </>
        ) : (
          "No prediction"
        )}
      </div>
      <div className="range-track" aria-hidden="true">
        <span
          style={{
            left: estimate ? `${(low / scale) * 100}%` : "20%",
            width: estimate ? `${((high - low) / scale) * 100}%` : "50%",
          }}
        />
        {estimate && (
          <>
            <i
              className="baseline-marker"
              style={{ left: `${((baseline || 0) / scale) * 100}%` }}
            />
            <i style={{ left: `${(estimate.prediction / scale) * 100}%` }} />
          </>
        )}
      </div>
      <div className="stat-baseline">
        <span>
          Baseline{" "}
          <strong>{baseline !== undefined ? number(baseline) : "—"}</strong>
        </span>
        {estimate && (
          <span className={active ? "correction" : "unchanged"}>
            {active ? (
              <>
                {difference >= 0 ? (
                  <ArrowUpRight size={13} />
                ) : (
                  <ArrowDownRight size={13} />
                )}
                {difference >= 0 ? "+" : ""}
                {number(difference)}
              </>
            ) : (
              <>
                <Check size={12} /> Baseline used
              </>
            )}
          </span>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [mode, setMode] = useState<DataMode>(getDataMode);
  return (
    <Dashboard
      key={mode}
      mode={mode}
      changeMode={(next) => {
        setDataMode(next);
        setMode(next);
      }}
    />
  );
}

function Dashboard({
  mode,
  changeMode,
}: {
  mode: DataMode;
  changeMode: (mode: DataMode) => void;
}) {
  const [view, setView] = useState<View>("predictions");
  const viewTitle =
    view === "board"
      ? "Daily forecasts"
      : view === "tracking"
        ? "Forecast history"
        : view === "insights"
          ? "Model insights"
          : "Predictions";
  const [help, setHelp] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [refresh, setRefresh] = useState(0);
  const [health, setHealth] = useState<{ stub_mode: boolean } | null>(null);
  const [healthError, setHealthError] = useState("");
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
  const [result, setResult] = useState<Prediction | null>(null);
  const [predictionBusy, setPredictionBusy] = useState(false);
  const [predictionError, setPredictionError] = useState("");
  const [backtest, setBacktest] = useState<Backtest | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const predictionAbort = useRef<AbortController | null>(null);
  const backtestAbort = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    predictionAbort.current?.abort();
    backtestAbort.current?.abort();
    setResult(null);
    setPredictionError("");
    setPredictionBusy(false);
    setBacktest(null);
    setBacktestError("");
    setBacktestBusy(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setHealthError("");
    setHealth(null);
    request<{ stub_mode: boolean }>("/health", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setHealth(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setHealthError(errorText(e));
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setGamesBusy(true);
    setGamesError("");
    setGames([]);
    setGameId("");
    setPlayers([]);
    setPlayerId("");
    resetPrediction();
    request<{ games: Game[] }>(`/games?date=${date}`, controller.signal)
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
  }, [date, refresh, resetPrediction]);

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
      request<{ players: Omit<Player, "team">[] }>(
        `/teams/${game.away_team_id}/players?season=${seasonFor(game.date)}`,
        controller.signal,
      ).then((data) =>
        data.players.map((p) => ({ ...p, team: game.away_team })),
      ),
      request<{ players: Omit<Player, "team">[] }>(
        `/teams/${game.home_team_id}/players?season=${seasonFor(game.date)}`,
        controller.signal,
      ).then((data) =>
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
  }, [game, rosterRefresh, resetPrediction]);

  useEffect(() => {
    resetPrediction();
  }, [playerId, override, minutes, seasons, resetPrediction]);
  useEffect(
    () => () => {
      predictionAbort.current?.abort();
      backtestAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (help) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [help]);

  async function predict() {
    if (!game || !player) return;
    const controller = new AbortController();
    predictionAbort.current?.abort();
    predictionAbort.current = controller;
    setPredictionBusy(true);
    setPredictionError("");
    setResult(null);
    try {
      const input: PredictionInput = {
        player_id: playerId,
        game_id: gameId,
        seasons: parseSeasons(seasons),
        ...(override ? { minutes } : {}),
      };
      const data = await request<Prediction>(
        "/predictions",
        controller.signal,
        input,
      );
      if (!controller.signal.aborted) setResult(data);
    } catch (e) {
      if (!controller.signal.aborted) setPredictionError(errorText(e));
    } finally {
      if (!controller.signal.aborted) setPredictionBusy(false);
    }
  }
  async function evaluate() {
    if (!player) return;
    const controller = new AbortController();
    backtestAbort.current = controller;
    setBacktestBusy(true);
    setBacktestError("");
    try {
      const data = await request<Backtest>("/backtests", controller.signal, {
        player_id: playerId,
        seasons: parseSeasons(seasons),
      });
      if (!controller.signal.aborted) setBacktest(data);
    } catch (e) {
      if (!controller.signal.aborted) setBacktestError(errorText(e));
    } finally {
      if (!controller.signal.aborted) setBacktestBusy(false);
    }
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

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="page-header">
          <div className="header-left">
            <Sidebar
              view={view}
              navigate={setView}
              help={() => setHelp(true)}
              online={health !== null}
            />
            <h1>
              {viewTitle}
              <span className="title-dot">.</span>
            </h1>
          </div>
          <div className="header-right">
            {portfolioEnabled && (
              <div
                className="experience-switch"
                role="group"
                aria-label="Data experience"
              >
                <button
                  aria-pressed={mode === "replay"}
                  onClick={() => changeMode("replay")}
                >
                  NBA replay
                </button>
                <button
                  aria-pressed={mode === "live"}
                  onClick={() => changeMode("live")}
                >
                  Live NBA
                </button>
              </div>
            )}
            <ThemeToggle />
            <span className={`mode-pill ${health?.stub_mode ? "demo" : ""}`}>
              <span />
              {mode === "replay"
                ? "Historical replay"
                : health
                  ? health.stub_mode
                    ? "Synthetic demo"
                    : "Live NBA data"
                  : "Connecting"}
            </span>
          </div>
        </header>
        {mode === "replay" && (
          <div className="replay-notice">
            <span>
              <strong>March 8, 2025 replay</strong> · Real NBA history, six
              featured players. Predictions were rebuilt after the games using
              earlier data.
            </span>
            <a href="https://github.com/segfaultering/basketball-prediction-performance-prediction-system#portfolio-demo">
              How it works ↗
            </a>
          </div>
        )}
        {mode === "live" && (
          <p className="live-notice">
            {health
              ? "Live NBA data can be delayed or unavailable. Your saved history stays in this browser."
              : "Connecting to the live API. The free server may take about a minute to wake up; NBA replay stays available."}
          </p>
        )}
        {healthError && (
          <ErrorNotice
            message={`Cannot reach the prediction engine: ${healthError}`}
            retry={() => setRefresh((n) => n + 1)}
          />
        )}

        {view === "board" ? (
          <DailyForecasts />
        ) : view === "tracking" ? (
          <ForecastTracking />
        ) : (
          <>
            <section className="schedule-section" aria-label="Scheduled games">
              <div className="section-heading">
                <StepTitle
                  step="01"
                  title="Games"
                  subtitle={mode === "replay" ? "NBA game date" : "UTC"}
                />
                <div className="date-controls">
                  <button
                    className="icon-button"
                    aria-label="Previous day"
                    disabled={mode === "replay"}
                    onClick={() => setDate(shiftDate(date, -1))}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <label className="date-picker">
                    <CalendarDays size={15} />
                    <input
                      aria-label={
                        mode === "replay"
                          ? "Replay date (NBA)"
                          : "Game date (UTC)"
                      }
                      type="date"
                      disabled={mode === "replay"}
                      value={date}
                      onChange={(e) => {
                        if (e.target.value) setDate(e.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label="Next day"
                    disabled={mode === "replay"}
                    onClick={() => setDate(shiftDate(date, 1))}
                  >
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="today-button"
                    onClick={() =>
                      setDate(mode === "replay" ? initialDate() : utcToday())
                    }
                  >
                    {mode === "replay" ? "Replay date" : "Today"}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Refresh games"
                    onClick={() => setRefresh((n) => n + 1)}
                    disabled={gamesBusy}
                  >
                    <RefreshCw size={16} className={gamesBusy ? "spin" : ""} />
                  </button>
                </div>
              </div>
              {gamesError ? (
                <ErrorNotice
                  message={gamesError}
                  retry={() => setRefresh((n) => n + 1)}
                />
              ) : gamesBusy ? (
                <div className="schedule-empty">
                  <LoaderCircle className="spin" size={20} />
                  Loading games…
                </div>
              ) : !games.length ? (
                <div className="schedule-empty">
                  <CalendarDays size={22} />
                  <div>
                    <strong>No scheduled games on {prettyDate(date)}.</strong>
                  </div>
                </div>
              ) : (
                <div className="games-strip">
                  {games.map((g) => (
                    <button
                      key={g.game_id}
                      className={`game-card ${g.game_id === gameId ? "selected" : ""}`}
                      aria-pressed={g.game_id === gameId}
                      onClick={() => setGameId(g.game_id)}
                    >
                      <div className="game-card-top">
                        <span>
                          <span className="small-dot" />
                          {g.replay_mode ? "REPLAY" : "SCHEDULED"}
                        </span>
                        <span>
                          {g.replay_mode ? "Completed game" : tipoff(g)}
                        </span>
                      </div>
                      <div className="matchup">
                        <TeamBadge team={g.away_team} />
                        <span className="matchup-at">at</span>
                        <TeamBadge team={g.home_team} />
                        {g.game_id === gameId && (
                          <span className="game-check">
                            <Check size={14} />
                          </span>
                        )}
                      </div>
                      <div className="game-card-bottom">
                        {g.away_team} away <span>·</span> {g.home_team} home
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div className="workspace-grid">
              <section className="selection-panel panel">
                <StepTitle step="02" title="Player" />
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search players"
                    placeholder="Search players…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={!game || playersBusy}
                  />
                  <kbd>⌕</kbd>
                </div>
                {game && (
                  <div
                    className="team-filters"
                    aria-label="Filter players by team"
                  >
                    {["all", game.away_team, game.home_team].map((team) => (
                      <button
                        key={team}
                        className={teamFilter === team ? "active" : ""}
                        onClick={() => setTeamFilter(team)}
                      >
                        {team === "all" ? "Both teams" : team}
                      </button>
                    ))}
                  </div>
                )}
                <div className="roster-list" aria-label="Player roster">
                  {playersError ? (
                    <ErrorNotice
                      message={playersError}
                      retry={() => setRosterRefresh((n) => n + 1)}
                    />
                  ) : playersBusy ? (
                    <div className="roster-placeholder">
                      <LoaderCircle className="spin" size={20} />
                      Loading players…
                    </div>
                  ) : !game ? (
                    <div className="roster-placeholder">Select a game.</div>
                  ) : !filteredPlayers.length ? (
                    <div className="roster-placeholder">
                      {players.length
                        ? "No players match your search."
                        : "No players available."}
                    </div>
                  ) : (
                    filteredPlayers.map((p) => (
                      <button
                        key={`${p.team}-${p.PLAYER_ID}`}
                        className={`player-option ${String(p.PLAYER_ID) === playerId ? "selected" : ""}`}
                        aria-pressed={String(p.PLAYER_ID) === playerId}
                        onClick={() => setPlayerId(String(p.PLAYER_ID))}
                      >
                        <span
                          className="player-avatar"
                          style={
                            {
                              "--team-color": teamColor(p.team),
                            } as React.CSSProperties
                          }
                        >
                          {initials(p.PLAYER)}
                        </span>
                        <span className="player-name">
                          {p.PLAYER}
                          <small>
                            {p.team}
                            {p.POSITION ? ` · ${p.POSITION}` : ""}
                          </small>
                        </span>
                        <span className="player-radio">
                          {String(p.PLAYER_ID) === playerId && (
                            <Check size={12} />
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="minutes-control">
                  <div>
                    <span className="control-heading">
                      <Clock3 size={16} />
                      Expected minutes
                    </span>
                    <label className="switch">
                      <input
                        aria-label="Set expected minutes"
                        type="checkbox"
                        checked={override}
                        onChange={(e) => setOverride(e.target.checked)}
                      />
                      <span />
                    </label>
                  </div>
                  {override ? (
                    <>
                      <div className="minutes-value">
                        <strong>{minutes}</strong>
                        <span>minutes</span>
                      </div>
                      <input
                        aria-label="Expected minutes"
                        type="range"
                        min="0"
                        max="48"
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                      />
                      <div className="slider-labels">
                        <span>0 min</span>
                        <span>48 min</span>
                      </div>
                    </>
                  ) : (
                    <p>
                      Estimated from recent playing time. Turn this on to try
                      your own minutes estimate.
                    </p>
                  )}
                </div>
                {mode !== "replay" && (
                  <details className="advanced-options">
                    <summary>
                      <SlidersHorizontal size={14} />
                      History options
                    </summary>
                    <label>
                      History seasons
                      <input
                        placeholder="Full career (automatic)"
                        value={seasons}
                        onChange={(e) => setSeasons(e.target.value)}
                      />
                    </label>
                    <p>
                      Leave blank to use the player’s full career. Enter up to
                      five seasons, such as 2024-25, 2025-26, to limit
                      prediction and backtest history.
                    </p>
                  </details>
                )}
                <button
                  className="predict-button"
                  disabled={
                    !game ||
                    !player ||
                    predictionBusy ||
                    playersBusy ||
                    gamesBusy
                  }
                  onClick={predict}
                >
                  {predictionBusy ? (
                    <>
                      <LoaderCircle size={18} className="spin" />
                      Predicting…
                    </>
                  ) : (
                    <>
                      <Sparkles size={17} />
                      Generate prediction
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </section>

              <section
                className="forecast-panel"
                aria-label="Player forecast"
                aria-busy={predictionBusy}
              >
                <div className="forecast-heading">
                  <StepTitle
                    step="03"
                    title={
                      view === "predictions" ? "Forecast" : "Model details"
                    }
                    subtitle={
                      player
                        ? `${player.PLAYER} · ${player.team}${game ? ` vs ${player.team === game.home_team ? game.away_team : game.home_team}` : ""}`
                        : "Select a player"
                    }
                  />
                  {result && (
                    <button
                      className="icon-button"
                      aria-label="Download prediction JSON"
                      onClick={download}
                    >
                      <Download size={17} />
                    </button>
                  )}
                </div>
                {predictionError && (
                  <ErrorNotice message={predictionError} retry={predict} />
                )}
                {predictionBusy && (
                  <div className="training-notice" role="status">
                    <LoaderCircle className="spin" size={18} />
                    <div>
                      <strong>Preparing prediction…</strong>
                    </div>
                  </div>
                )}
                {!result && !predictionBusy && (
                  <div className="forecast-empty">
                    <span className="empty-icon">
                      <Target size={25} />
                    </span>
                    <div>
                      <strong>
                        {player ? "Ready to predict" : "Choose a player"}
                      </strong>
                    </div>
                  </div>
                )}
                {result && (
                  <div className="forecast-meta">
                    {result.forecast_id && (
                      <span>
                        <Check size={14} />{" "}
                        {result.replay_mode ? "Saved replay" : "Saved"}
                      </span>
                    )}
                    <span>
                      <Clock3 size={14} />
                      <strong>{number(result.projected_minutes)}</strong>{" "}
                      expected minutes
                    </span>
                    <span>
                      <Activity size={14} />
                      <strong>{result.history_games}</strong> past games
                    </span>
                    <span className="forecast-date">
                      {prettyDate(result.game_date)}
                    </span>
                  </div>
                )}
                {view === "predictions" ? (
                  <>
                    <div className="primary-stats">
                      {(["points", "rebounds", "assists"] as Stat[]).map(
                        (stat) => (
                          <StatCard key={stat} stat={stat} result={result} />
                        ),
                      )}
                    </div>
                    <div className="secondary-stats">
                      {(["steals", "blocks"] as Stat[]).map((stat) => (
                        <div key={stat}>
                          <span className="secondary-icon">
                            <ShieldCheck size={18} />
                          </span>
                          <div>
                            <span>{LABELS[stat]}</span>
                            <strong>
                              {result
                                ? number(result.stats[stat].prediction)
                                : "—"}
                            </strong>
                          </div>
                          <span className="secondary-range">
                            {result
                              ? `${number(result.stats[stat].approximate_80pct_range[0])} – ${number(result.stats[stat].approximate_80pct_range[1])}`
                              : "Awaiting prediction"}
                            <small>{result ? "80% range (approx.)" : ""}</small>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="legend">
                      <span>
                        <i className="legend-orange" />
                        Prediction
                      </span>
                      <span>
                        <i className="legend-gray" />
                        Baseline
                      </span>
                      <button onClick={() => setView("insights")}>
                        Model insights <ArrowUpRight size={13} />
                      </button>
                    </div>
                    {result && <ModelAccuracy result={result} />}
                    {result && (
                      <MinutesExplorer
                        key={`${result.player_id}:${result.game_id}:${result.projected_minutes}`}
                        current={result}
                        input={{
                          player_id: playerId,
                          game_id: gameId,
                          seasons: parseSeasons(seasons),
                        }}
                      />
                    )}
                  </>
                ) : (
                  <div className="insights-panel panel">
                    <div className="insights-intro">
                      <BarChart3 size={22} />
                      <div>
                        <h3>Validation: choosing the forecast method</h3>
                        <p>
                          The baseline is a starting estimate from past stats
                          and expected minutes. A learned adjustment
                          (correction) is used only when it lowers the average
                          miss on later historical games.
                        </p>
                      </div>
                    </div>
                    {result ? (
                      <>
                        <div className="model-status-row">
                          <span className="tag">
                            {result.model.status === "trained"
                              ? "Models trained"
                              : "Baseline only"}
                          </span>
                          <span>
                            {result.model.evaluation
                              ? `${result.model.evaluation.validation_games} validation games`
                              : "More history needed to validate corrections"}
                          </span>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Stat</th>
                                <th>Baseline MAE</th>
                                <th>Model MAE</th>
                                <th>Used</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(
                                ["points", "rebounds", "assists"] as Stat[]
                              ).map((s) => {
                                const model = result.model.stats[s];
                                return (
                                  <tr key={s}>
                                    <th>{LABELS[s]}</th>
                                    <td>
                                      {model?.baseline_mae !== undefined
                                        ? number(model.baseline_mae)
                                        : "—"}
                                    </td>
                                    <td>
                                      {model?.model_mae !== undefined
                                        ? number(model.model_mae)
                                        : "—"}
                                    </td>
                                    <td>
                                      <span
                                        className={`tag ${model?.active ? "positive" : ""}`}
                                      >
                                        {model?.active
                                          ? "Correction"
                                          : "Baseline"}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <AccuracyGuide />
                        <p className="table-note">
                          These games help choose the method, so their errors
                          are not an independent test of future accuracy.
                          Points, rebounds, and assists can use corrections;
                          steals and blocks use the baseline.
                        </p>
                      </>
                    ) : (
                      <p className="table-note">
                        Generate a prediction to see this player’s validation
                        results.
                      </p>
                    )}
                    <div className="evaluation-section">
                      <h3>Backtest: test predictions on past games</h3>
                      <p>
                        For each past game, rebuild a forecast using only games
                        played before it, then compare with the actual stats.
                        This shows how the forecasting process would have
                        performed as the player’s history grew.
                      </p>
                      <p>
                        {mode === "replay"
                          ? "NBA replay loads a prepared backtest for the selected player."
                          : "Uses the selected player and history seasons, with playing time estimated from earlier games. Your minutes override does not apply. Full-career runs may take several minutes."}
                      </p>
                      {!player && (
                        <p className="table-note">
                          Select a game and player to enable the backtest.
                        </p>
                      )}
                      <button
                        className="outline-button"
                        onClick={evaluate}
                        disabled={!player || backtestBusy}
                      >
                        {backtestBusy ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Activity size={15} />
                        )}
                        {backtestBusy
                          ? "Evaluating past games…"
                          : "Run backtest"}
                      </button>
                      {backtestError && <ErrorNotice message={backtestError} />}
                      {backtest && (
                        <>
                          {backtest.evaluation_scope && (
                            <p className="table-note">
                              {backtest.evaluation_scope}
                            </p>
                          )}
                          <p className="evaluation-count">
                            {backtest.evaluated_games} games evaluated
                            {backtest.stub_mode ? " · Synthetic data" : ""}
                          </p>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Stat</th>
                                  <th>Prediction MAE</th>
                                  <th>Baseline MAE</th>
                                  <th>RMSE</th>
                                </tr>
                              </thead>
                              <tbody>
                                {STATS.map((s) => (
                                  <tr key={s}>
                                    <th>{LABELS[s]}</th>
                                    <td>{number(backtest.stats[s].mae)}</td>
                                    <td>
                                      {number(
                                        backtest.stats[s].blended_baseline_mae,
                                      )}
                                    </td>
                                    <td>{number(backtest.stats[s].rmse)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <AccuracyGuide extended />
                          <p className="table-note">
                            Historical results help assess the forecast, but do
                            not guarantee the same accuracy in future games.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="forecast-note">
                  <Info size={16} />
                  <p>
                    Assumes the player plays. The 80% range shows an approximate
                    spread around the estimate; it has not been checked to
                    contain actual results 80% of the time.
                  </p>
                </div>
                {result?.stub_mode && (
                  <div className="synthetic-notice">
                    <span className="orange-dot" />
                    Synthetic data · Not an NBA forecast.
                  </div>
                )}
                {result && (
                  <details className="prediction-details">
                    <summary>
                      Prediction details <ChevronRight size={14} />
                    </summary>
                    <div className="details-metadata">
                      <span>
                        Latest game: {prettyDate(result.last_history_date)}
                      </span>
                      <span>
                        {result.model.cache_hit
                          ? "Saved model reused"
                          : "Model prepared from history"}
                      </span>
                    </div>
                    {result.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                    <pre>{JSON.stringify(result, null, 2)}</pre>
                  </details>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <dialog
        ref={dialogRef}
        aria-labelledby="help-title"
        onCancel={() => setHelp(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setHelp(false);
        }}
        className="help-dialog"
      >
        <button
          className="icon-button close-dialog"
          aria-label="Close explanation"
          onClick={() => setHelp(false)}
        >
          <X size={20} />
        </button>

        <h2 id="help-title">How forecasts work</h2>
        <div className="help-step">
          <span>01</span>
          <div>
            <h3>Baseline: the starting estimate</h3>
            <p>
              Use past stats per minute and expected playing time to make a
              starting estimate. More expected minutes usually means higher
              projected stats.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>02</span>
          <div>
            <h3>Correction: a learned adjustment</h3>
            <p>
              Learn from the player’s history to adjust the baseline using
              recent stats, minutes, home court, and rest.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>03</span>
          <div>
            <h3>Validation: choose which method to use</h3>
            <p>
              Only use a correction when it lowers error on later historical
              games. Otherwise, keep the baseline.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>04</span>
          <div>
            <h3>Backtest: check against past results</h3>
            <p>
              Rebuild forecasts for past games using only earlier history, then
              compare them with what happened. Open Model insights to run a
              backtest. This checks the process across past games; validation
              chooses whether to use a correction.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>05</span>
          <div>
            <h3>Forecast history: follow saved predictions</h3>
            <p>
              Compare saved predictions with final stats when results are
              available. NBA replay uses completed games and forecasts rebuilt
              afterward from earlier data. Those comparisons do not show
              predictions actually made before tipoff.
            </p>
          </div>
        </div>
        <div className="help-caveat">
          <Info size={17} />
          <p>
            The projected value is an estimate, not an exact result. The 80%
            range shows possible variation, but is not a verified 80% chance.
          </p>
        </div>
        <button className="predict-button" onClick={() => setHelp(false)}>
          Done <ArrowRight size={17} />
        </button>
      </dialog>
    </div>
  );
}
