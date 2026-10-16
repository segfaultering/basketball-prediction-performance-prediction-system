import type { DataMode } from "./api";
import { prettyDate, shiftDate, tipoff, utcToday, initialDate } from "./api";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { StepTitle, ErrorNotice } from "./WorkflowUi";
import TeamBadge from "./TeamBadge";
import type { PredictionWorkflow } from "./usePredictionWorkflow";

export default function ScheduleSection({
  workflow,
  mode,
}: {
  workflow: PredictionWorkflow;
  mode: DataMode;
}) {
  const {
    date,
    setDate,
    setRefresh,
    games,
    gameId,
    setGameId,
    gamesBusy,
    gamesError,
  } = workflow;
  return (
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
                mode === "replay" ? "Replay date (NBA)" : "Game date (UTC)"
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
              setDate(mode === "replay" ? initialDate(mode) : utcToday())
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
                <span>{g.replay_mode ? "Completed game" : tipoff(g)}</span>
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
  );
}
