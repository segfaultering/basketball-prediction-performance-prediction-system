import type { DataMode } from "./api";
import {
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { StepTitle, ErrorNotice } from "./WorkflowUi";
import type { PredictionWorkflow } from "./usePredictionWorkflow";
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
const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

export default function PlayerSelection({
  workflow,
  mode,
}: {
  workflow: PredictionWorkflow;
  mode: DataMode;
}) {
  const {
    game,
    gamesBusy,
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
    predictionBusy,
    predict,
  } = workflow;
  return (
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
            Estimated from recent playing time. Turn this on to try your own
            minutes estimate.
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
            Leave blank to use the player’s full career. Enter up to five
            seasons, such as 2024-25, 2025-26, to limit prediction and backtest
            history.
          </p>
        </details>
      )}
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
  );
}
