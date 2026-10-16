import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Clock3, Eye, RotateCcw } from "lucide-react";
import { ABBREVIATIONS, LABELS, STATS, TARGET_STATS } from "./types";
import type { Stat } from "./types";
import type { ReplayReport } from "./portfolio";
import { useRequest } from "./useRequest";
import TeamBadge from "./TeamBadge";

const number = (value: number) => value.toFixed(1);
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;

export default function ReplaySpotlight() {
  const { data, error, run } = useRequest<ReplayReport[]>();
  const [playerId, setPlayerId] = useState("201939");
  useEffect(() => {
    void run(async (signal) => {
      const { loadReplayReports } = await import("./portfolio");
      return loadReplayReports(signal);
    });
  }, [run]);
  const report =
    data?.find((item) => item.prediction.player_id === playerId) ?? data?.[0];

  return (
    <section
      className="replay-spotlight"
      aria-label="Interactive scouting report"
    >
      <div className="spotlight-masthead">
        <span className="spotlight-wordmark">
          courtside<span>.</span>
        </span>
        <span className="spotlight-edition">
          THE SCOUTING ROOM <span>/ VOL. 01</span>
        </span>
        <span className="spotlight-replay">
          <i /> March 8, 2025 replay
        </span>
      </div>
      {report ? (
        <>
          <div className="spotlight-layout">
            <div className="spotlight-intro">
              <span className="spotlight-eyebrow">
                A different way to read the game
              </span>
              <h2>
                Every minute <br />
                changes <br />
                <em>the game.</em>
              </h2>
              <p>
                The box score starts with playing time. Change the minutes.
                Follow the forecast. Then see what happened.
              </p>
              <a
                className="spotlight-workspace-link"
                href="#forecast-workspace"
              >
                Build your own forecast <ArrowUpRight size={18} />
              </a>
              <div className="spotlight-method">
                <span>Real NBA history</span>
                <span>Interactive projections</span>
              </div>
            </div>
            <ScoutingReport key={report.prediction.player_id} report={report} />
          </div>
          <div
            className="spotlight-roster"
            role="group"
            aria-label="Featured replay players"
          >
            <div className="spotlight-roster-label">
              <span>Pick your player</span>
              <small>
                {String(data?.length ?? 0).padStart(2, "0")} scouting reports{" "}
                <ArrowDown size={12} />
              </small>
            </div>
            {data?.map(({ player, prediction }) => (
              <button
                key={prediction.player_id}
                aria-pressed={
                  report.prediction.player_id === prediction.player_id
                }
                onClick={() => setPlayerId(prediction.player_id)}
              >
                <TeamBadge team={player.team} small />
                <span>
                  <strong>{player.PLAYER}</strong>
                  <small>
                    {player.team} <span>vs</span> {prediction.opponent}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="spotlight-loading">
          <h2>Every minute changes the game.</h2>
          {error ? (
            <p role="alert">
              {error}{" "}
              <a href="#forecast-workspace">
                Open the forecast workspace <ArrowDown size={14} />
              </a>
            </p>
          ) : (
            <p role="status">Opening the scouting room…</p>
          )}
        </div>
      )}
      <p className="spotlight-disclosure">
        A retrospective experience. Forecasts were rebuilt after these games
        using earlier data; this is not a record of pregame predictions. Minutes
        scenarios hold per-minute rates fixed and assume the player plays.
      </p>
    </section>
  );
}

function ScoutingReport({ report }: { report: ReplayReport }) {
  const { player, prediction, scenarios, outcome } = report;
  const [minutes, setMinutes] = useState(
    Math.round(prediction.projected_minutes),
  );
  const [stat, setStat] = useState<Stat>("points");
  const [revealed, setRevealed] = useState(false);
  const selected = scenarios.find((item) => item.projected_minutes === minutes);
  if (!selected) return null;

  const ordered = [...scenarios].sort(
    (a, b) => a.projected_minutes - b.projected_minutes,
  );
  const max = Math.max(
    1,
    ...ordered.map((item) => item.stats[stat].prediction),
  );
  const x = (value: number) => 24 + (value / 48) * 440;
  const y = (value: number) => 124 - (value / max) * 104;
  const estimate = prediction.stats[stat].prediction;
  const value = selected.stats[stat].prediction;
  const firstName = player.PLAYER.split(" ").slice(0, -1).join(" ");
  const lastName = player.PLAYER.split(" ").at(-1);

  return (
    <section
      className="scouting-report"
      aria-label={`${player.PLAYER} scouting report`}
    >
      <div className="scouting-report-topline">
        <span>
          <span className="spotlight-live-dot" /> MINUTES LAB
        </span>
        <span>
          {prediction.home ? "HOME" : "AWAY"} / {prediction.team} vs{" "}
          {prediction.opponent}
        </span>
      </div>
      <div className="scouting-player">
        <div>
          <span>{firstName}</span>
          <h3>{lastName}</h3>
        </div>
        <TeamBadge team={player.team} />
      </div>
      <div
        className="scouting-stat-tabs"
        role="group"
        aria-label="Spotlight statistic"
      >
        {TARGET_STATS.map((item) => (
          <button
            key={item}
            aria-pressed={stat === item}
            onClick={() => setStat(item)}
          >
            {LABELS[item]}
          </button>
        ))}
      </div>
      <div className="scouting-projection">
        <div>
          <strong>{number(value)}</strong>
          <span>
            projected
            <br />
            {LABELS[stat].toLowerCase()}
          </span>
        </div>
        <span className="scouting-delta">
          {signed(value - estimate)}
          <small>vs recent-minutes estimate</small>
        </span>
      </div>
      <svg
        className="scouting-chart"
        viewBox="0 0 488 150"
        role="img"
        aria-label={`${LABELS[stat]} projection at ${minutes} minutes: ${number(value)}. The model holds per-minute rates fixed.`}
      >
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            className="scouting-chart-grid"
            x1="24"
            x2="464"
            y1={y(max * fraction)}
            y2={y(max * fraction)}
          />
        ))}
        <polygon
          className="scouting-chart-area"
          points={`24,124 ${ordered.map((item) => `${x(item.projected_minutes)},${y(item.stats[stat].prediction)}`).join(" ")} 464,124`}
        />
        <polyline
          className="scouting-chart-line"
          points={ordered
            .map(
              (item) =>
                `${x(item.projected_minutes)},${y(item.stats[stat].prediction)}`,
            )
            .join(" ")}
        />
        <line
          className="scouting-chart-reference"
          x1={x(prediction.projected_minutes)}
          x2={x(prediction.projected_minutes)}
          y1="14"
          y2="124"
        />
        <circle
          className="scouting-chart-reference-dot"
          cx={x(prediction.projected_minutes)}
          cy={y(estimate)}
          r="4"
        />
        <line
          className="scouting-chart-cursor"
          x1={x(minutes)}
          x2={x(minutes)}
          y1={y(value)}
          y2="124"
        />
        <circle
          className="scouting-chart-halo"
          cx={x(minutes)}
          cy={y(value)}
          r="11"
        />
        <circle
          className="scouting-chart-dot"
          cx={x(minutes)}
          cy={y(value)}
          r="5"
        />
        {[0, 12, 24, 36, 48].map((tick) => (
          <text key={tick} x={x(tick)} y="145" textAnchor="middle">
            {tick}
            {tick === 48 ? " min" : ""}
          </text>
        ))}
      </svg>
      <div className="scouting-minutes-label">
        <label htmlFor="spotlight-minutes">
          <Clock3 size={14} /> Your playing-time scenario
        </label>
        <output htmlFor="spotlight-minutes">
          {minutes}
          <small> MIN</small>
        </output>
      </div>
      <input
        id="spotlight-minutes"
        className="scouting-slider"
        type="range"
        min="0"
        max="48"
        step="1"
        value={minutes}
        onChange={(event) => setMinutes(Number(event.target.value))}
      />
      <div className="scouting-minute-presets">
        <span>0 min</span>
        <button
          onClick={() => setMinutes(Math.round(prediction.projected_minutes))}
        >
          <RotateCcw size={11} /> Recent estimate:{" "}
          {number(prediction.projected_minutes)} min
        </button>
        <span>48 min</span>
      </div>
      <div className="scouting-box-score">
        <div className="scouting-box-score-heading">
          <span>THE PROJECTED BOX SCORE</span>
          <button
            aria-expanded={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            <Eye size={13} />
            {revealed ? "Hide actual result" : "Reveal actual result"}
          </button>
        </div>
        <div className="scouting-box-score-grid">
          {STATS.map((item) => (
            <div key={item}>
              <span>{ABBREVIATIONS[item]}</span>
              <strong>{number(selected.stats[item].prediction)}</strong>
              {revealed && (
                <small>
                  {outcome.minutes > 0
                    ? `${number(outcome.stats[item])} actual`
                    : "DNP"}
                </small>
              )}
            </div>
          ))}
        </div>
        {revealed && (
          <p className="scouting-result-note" role="status">
            {outcome.minutes > 0
              ? `Actual playing time: ${number(outcome.minutes)} minutes. Compare this scenario with the final box score; one game does not measure model accuracy.`
              : "Did not play. Forecasts assume participation, so this game is excluded from accuracy scoring."}
          </p>
        )}
      </div>
      <p className="scouting-chart-key">
        <span /> Dashed marker: recent-minutes estimate. Scenario preview;
        nothing is saved.
      </p>
    </section>
  );
}
