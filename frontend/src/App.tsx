import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  CircleHelp,
  Clock3,
  Download,
  Info,
  LayoutDashboard,
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
} from "./api";
import type {
  Backtest,
  Game,
  Player,
  Prediction,
  PredictionInput,
  Stat,
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

function Court({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 190"
      fill="none"
      aria-hidden="true"
    >
      <rect x="10" y="10" width="300" height="170" rx="5" />
      <path d="M160 10v170M10 53h58v84H10M310 53h-58v84h58M10 75h28v40H10M310 75h-28v40h28" />
      <circle cx="160" cy="95" r="24" />
      <circle cx="68" cy="95" r="22" />
      <circle cx="252" cy="95" r="22" />
      <path d="M10 25h19a83 83 0 0 1 0 140H10M310 25h-19a83 83 0 0 0 0 140h19" />
    </svg>
  );
}
function Ball() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="12" />
      <path d="M4 16h24M16 4v24M7 7c12 0 18 6 18 18M7 25C7 13 13 7 25 7" />
    </svg>
  );
}
function TeamBadge({ team, small = false }: { team: string; small?: boolean }) {
  return (
    <span
      className={`team-badge ${small ? "small" : ""}`}
      style={{ "--team-color": teamColor(team) } as React.CSSProperties}
    >
      {team}
    </span>
  );
}
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
  return (
    <div className="error-notice" role="alert">
      <Info size={17} />
      <span>{message}</span>
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
            approximate 80% range
          </>
        ) : (
          "Your estimate will appear here"
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
  const [view, setView] = useState<"predictions" | "insights">("predictions");
  const [help, setHelp] = useState(false);
  const [date, setDate] = useState(utcToday);
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
      <aside className="sidebar">
        <a className="brand" href="/ui/" aria-label="Courtside home">
          <span className="brand-mark">
            <Ball />
          </span>
          <span>
            courtside<span className="brand-dot">.</span>
            <small>THE PLAYER PERFORMANCE LAB</small>
          </span>
        </a>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={view === "predictions" ? "active" : ""}
            onClick={() => setView("predictions")}
          >
            <LayoutDashboard size={18} />
            Player predictions
            <span className="nav-indicator" />
          </button>
          <button
            className={view === "insights" ? "active" : ""}
            onClick={() => setView("insights")}
          >
            <BarChart3 size={18} />
            Model insights
          </button>
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            How it works
          </button>
        </nav>
        <div className="sidebar-note">
          <Court />
          <span className="eyebrow">HISTORY MEETS POSSIBILITY</span>
          <p>
            Every great game
            <br />
            starts with a little
            <br />
            <strong>perspective.</strong>
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className={`connection-dot ${health ? "connected" : ""}`} />
          <div>
            {health ? "Prediction engine online" : "Connecting to engine"}
            <small>NBA player analytics</small>
          </div>
          <a
            href="/docs"
            aria-label="Open API documentation"
            title="API documentation"
          >
            <ArrowUpRight size={17} />
          </a>
        </div>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <div className="breadcrumb">
              Workspace <ChevronRight size={12} />{" "}
              {view === "predictions" ? "Player predictions" : "Model insights"}
            </div>
            <h1>
              {view === "predictions" ? "Player predictions" : "Model insights"}
              <span className="title-dot">.</span>
            </h1>
          </div>
          <div className="header-right">
            <span className={`mode-pill ${health?.stub_mode ? "demo" : ""}`}>
              <span />
              {health
                ? health.stub_mode
                  ? "Synthetic demo"
                  : "Live NBA data"
                : "Connecting"}
            </span>
            <button
              className="icon-button"
              aria-label="How it works"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        {healthError && (
          <ErrorNotice
            message={`Cannot reach the prediction engine: ${healthError}`}
            retry={() => setRefresh((n) => n + 1)}
          />
        )}

        {view === "predictions" && (
          <section className="hero">
            <div className="hero-content">
              <span className="eyebrow">
                <span className="orange-dot" />
                AHEAD OF THE GAME
              </span>
              <h2>
                Read the game.
                <br />
                Before the <span>tip.</span>
              </h2>
              <p>
                Player projections grounded in history.
                <br className="desktop-break" /> A clearer view of what comes
                next.
              </p>
            </div>
            <div className="hero-art">
              <Court />
              <span className="court-label">
                THE GAME, IN FOCUS <ArrowUpRight size={14} />
              </span>
              <div className="court-ball">
                <Ball />
              </div>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={14} /> Individual baselines. Validated
              corrections.
            </div>
          </section>
        )}

        <section className="schedule-section" aria-label="Scheduled games">
          <div className="section-heading">
            <StepTitle
              step="01"
              title="Set the stage"
              subtitle="Pick a scheduled matchup. All times are UTC."
            />
            <div className="date-controls">
              <button
                className="icon-button"
                aria-label="Previous day"
                onClick={() => setDate(shiftDate(date, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <label className="date-picker">
                <CalendarDays size={15} />
                <input
                  aria-label="Game date (UTC)"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) setDate(e.target.value);
                  }}
                />
              </label>
              <button
                className="icon-button"
                aria-label="Next day"
                onClick={() => setDate(shiftDate(date, 1))}
              >
                <ChevronRight size={17} />
              </button>
              <button
                className="today-button"
                onClick={() => setDate(utcToday())}
              >
                Today
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
              Loading scheduled games…
            </div>
          ) : !games.length ? (
            <div className="schedule-empty">
              <CalendarDays size={22} />
              <div>
                <strong>No scheduled games on {prettyDate(date)}.</strong>
                <p>Try another date to find an upcoming matchup.</p>
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
                      SCHEDULED
                    </span>
                    <span>{tipoff(g)}</span>
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
            <StepTitle
              step="02"
              title="Choose your player"
              subtitle="Find a player from either team’s roster."
            />
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
              <div className="team-filters" aria-label="Filter players by team">
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
                  Loading the rosters…
                </div>
              ) : !game ? (
                <div className="roster-placeholder">
                  Select a scheduled game first.
                </div>
              ) : !filteredPlayers.length ? (
                <div className="roster-placeholder">
                  {players.length
                    ? "No players match your search."
                    : "No roster players returned for this game."}
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
                      {String(p.PLAYER_ID) === playerId && <Check size={12} />}
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
                    <span>minutes on the court</span>
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
                <p>Estimated automatically from recent playing time.</p>
              )}
            </div>
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
              <p>Optional override, e.g. 2024-25, 2025-26.</p>
            </details>
            <button
              className="predict-button"
              disabled={
                !game || !player || predictionBusy || playersBusy || gamesBusy
              }
              onClick={predict}
            >
              {predictionBusy ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  Building your prediction…
                </>
              ) : (
                <>
                  <Sparkles size={17} />
                  Generate prediction
                  <ArrowRight size={17} />
                </>
              )}
            </button>
            <p className="selection-footnote">
              <ShieldCheck size={12} />
              History is retrieved and models are trained for you.
            </p>
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
                  view === "predictions"
                    ? "The player forecast"
                    : "Behind the prediction"
                }
                subtitle={
                  player
                    ? `${player.PLAYER} · ${player.team}${game ? ` vs ${player.team === game.home_team ? game.away_team : game.home_team}` : ""}`
                    : "Select a player to get a clearer picture."
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
                  <strong>Putting the history to work.</strong>
                  <p>
                    We’re retrieving games and preparing this player’s model.
                    The first prediction may take a little longer.
                  </p>
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
                    {player
                      ? "Ready when you are."
                      : "One player. A world of possibility."}
                  </strong>
                  <p>
                    {player
                      ? "Generate a prediction to see projected stats and their historical baseline."
                      : "Choose a player, then let their history do the talking."}
                  </p>
                </div>
              </div>
            )}
            {result && (
              <div className="forecast-meta">
                <span>
                  <Clock3 size={14} />
                  <strong>{number(result.projected_minutes)}</strong> expected
                  minutes
                </span>
                <span>
                  <Activity size={14} />
                  <strong>{result.history_games}</strong> historical games
                </span>
                <span className="forecast-date">
                  {prettyDate(result.game_date)}
                </span>
              </div>
            )}
            {view === "predictions" ? (
              <>
                <div className="primary-stats">
                  {(["points", "rebounds", "assists"] as Stat[]).map((stat) => (
                    <StatCard key={stat} stat={stat} result={result} />
                  ))}
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
                          {result ? number(result.stats[stat].prediction) : "—"}
                        </strong>
                      </div>
                      <span className="secondary-range">
                        {result
                          ? `${number(result.stats[stat].approximate_80pct_range[0])} – ${number(result.stats[stat].approximate_80pct_range[1])}`
                          : "Awaiting prediction"}
                        <small>
                          {result
                            ? "approximate 80% range"
                            : "Your supporting stats"}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="legend">
                  <span>
                    <i className="legend-orange" />
                    Final prediction
                  </span>
                  <span>
                    <i className="legend-gray" />
                    Historical baseline
                  </span>
                  <button onClick={() => setView("insights")}>
                    Explore model insights <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            ) : (
              <div className="insights-panel panel">
                <div className="insights-intro">
                  <BarChart3 size={22} />
                  <div>
                    <h3>A correction has to earn its place.</h3>
                    <p>
                      Each stat keeps its baseline unless the learned correction
                      improves average error on later historical games.
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
                          {(["points", "rebounds", "assists"] as Stat[]).map(
                            (s) => {
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
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="table-note">
                      MAE = average absolute error. Lower is better. These
                      results guide model selection; they don’t guarantee future
                      accuracy.
                    </p>
                  </>
                ) : (
                  <p className="table-note">
                    Generate a prediction to see this player’s validation
                    results.
                  </p>
                )}
                <div className="evaluation-section">
                  <h3>Put it to the test</h3>
                  <p>
                    Replay earlier games using only the history available before
                    each matchup. Full-career evaluation can take several
                    minutes.
                  </p>
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
                      ? "Evaluating historical games…"
                      : "Run chronological backtest"}
                  </button>
                  {backtestError && <ErrorNotice message={backtestError} />}
                  {backtest && (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="forecast-note">
              <Info size={16} />
              <p>
                Predictions assume the player participates. Ranges are
                approximate and uncalibrated; injuries, lineups, and pace aren’t
                included.
              </p>
            </div>
            {result?.stub_mode && (
              <div className="synthetic-notice">
                <span className="orange-dot" />
                Synthetic demonstration data. This is not a real NBA forecast.
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
        <footer className="page-footer">
          <span>
            COURTSIDE <span>·</span> A little more perspective.
          </span>
          <span>Grounded in history. Built for the next game.</span>
        </footer>
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
        <span className="eyebrow">THE THINKING BEHIND THE NUMBERS</span>
        <h2 id="help-title">
          History first.
          <br />
          Intelligence second.
        </h2>
        <div className="help-step">
          <span>01</span>
          <div>
            <h3>Start with a player’s baseline</h3>
            <p>
              Blend historical and current-season production per minute, then
              multiply by expected playing time.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>02</span>
          <div>
            <h3>Learn what history can add</h3>
            <p>
              A player-specific linear model learns a correction using recent
              production, minutes, home court, and rest.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>03</span>
          <div>
            <h3>Make the correction prove itself</h3>
            <p>
              Only use a correction when it lowers error on later historical
              games. Otherwise, keep the baseline.
            </p>
          </div>
        </div>
        <div className="help-caveat">
          <Info size={17} />
          <p>
            A projection is an estimate, not a promise. Approximate ranges are
            not calibrated confidence intervals.
          </p>
        </div>
        <button className="predict-button" onClick={() => setHelp(false)}>
          Back to the game <ArrowRight size={17} />
        </button>
      </dialog>
    </div>
  );
}
