import { TARGET_STATS, parseSeasons, LABELS, prettyDate } from "./api";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  ShieldCheck,
  Target,
} from "lucide-react";
import { StepTitle, ErrorNotice } from "./WorkflowUi";
import StatCard from "./StatCard";
import ModelAccuracy from "./ModelAccuracy";
import MinutesExplorer from "./MinutesExplorer";
import type { Stat, DataMode } from "./api";
import type { View } from "./Sidebar";
import type { PredictionWorkflow } from "./usePredictionWorkflow";
import ModelInsights from "./ModelInsights";
const number = (value: number) => value.toFixed(1);

export default function ForecastPanel({
  workflow,
  mode,
  view,
  setView,
}: {
  workflow: PredictionWorkflow;
  mode: DataMode;
  view: View;
  setView: (view: View) => void;
}) {
  const {
    game,
    gameId,
    player,
    playerId,
    seasons,
    result,
    predictionBusy,
    predictionError,
    predict,
    download,
  } = workflow;
  return (
    <section
      className="forecast-panel"
      aria-label="Player forecast"
      aria-busy={predictionBusy}
    >
      <div className="forecast-heading">
        <StepTitle
          step="03"
          title={view === "predictions" ? "Forecast" : "Model details"}
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
            <strong>{player ? "Ready to predict" : "Choose a player"}</strong>
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
            <strong>{number(result.projected_minutes)}</strong> expected minutes
          </span>
          <span>
            <Activity size={14} />
            <strong>{result.history_games}</strong> past games
          </span>
          <span className="forecast-date">{prettyDate(result.game_date)}</span>
        </div>
      )}
      {view === "predictions" ? (
        <>
          <div className="primary-stats">
            {TARGET_STATS.map((stat) => (
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
        <ModelInsights workflow={workflow} mode={mode} />
      )}
      <div className="forecast-note">
        <Info size={16} />
        <p>
          Assumes the player plays. The 80% range shows an approximate spread
          around the estimate; it has not been checked to contain actual results
          80% of the time.
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
            <span>Latest game: {prettyDate(result.last_history_date)}</span>
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
  );
}
