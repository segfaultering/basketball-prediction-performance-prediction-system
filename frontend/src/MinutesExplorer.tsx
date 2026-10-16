import { useState } from "react";
import { LABELS, STATS } from "./api";
import type { MinuteScenarios, Prediction, PredictionInput, Stat } from "./api";

import { useApi } from "./ApiContext";
import { useRequest } from "./useRequest";

export default function MinutesExplorer({
  current,
  input,
}: {
  current: Prediction;
  input: Omit<PredictionInput, "minutes">;
}) {
  const [open, setOpen] = useState(false);
  const api = useApi();
  const { data, busy, error, run } = useRequest<MinuteScenarios>({
    errorMessage: "Scenarios unavailable.",
  });
  const [minutes, setMinutes] = useState(Math.round(current.projected_minutes));
  const [stat, setStat] = useState<Stat>("points");
  async function load() {
    setOpen(true);
    await run((signal) => api.scenarios(input, signal));
  }

  const selected = data?.scenarios.find((s) => s.projected_minutes === minutes);
  const x = (minute: number) => 44 + (minute / 48) * 472;
  const max = Math.max(
    1,
    ...(data?.scenarios.map((s) => s.stats[stat].approximate_80pct_range[1]) ||
      []),
    current.stats[stat].prediction,
  );
  const y = (value: number) => 176 - (value / max) * 148;
  const curve = data?.scenarios
    .map((s) => `${x(s.projected_minutes)},${y(s.stats[stat].prediction)}`)
    .join(" ");
  const band = data
    ? [
        ...data.scenarios.map(
          (s) =>
            `${x(s.projected_minutes)},${y(s.stats[stat].approximate_80pct_range[1])}`,
        ),
        ...[...data.scenarios]
          .reverse()
          .map(
            (s) =>
              `${x(s.projected_minutes)},${y(s.stats[stat].approximate_80pct_range[0])}`,
          ),
      ].join(" ")
    : "";

  return (
    <section
      className="minutes-explorer"
      aria-label="Minutes scenario explorer"
    >
      <div className="minutes-explorer-heading">
        <div>
          <h3>Minutes scenario explorer</h3>
          <p>See how playing time changes this forecast.</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (open) setOpen(false);
            else if (data || busy) setOpen(true);
            else void load();
          }}
        >
          {open ? "Close explorer" : "Explore minutes"}
        </button>
      </div>
      {open && (
        <div className="minutes-explorer-body">
          {busy && <p role="status">Preparing minutes scenarios…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => void load()}>
                Retry scenarios
              </button>
            </div>
          )}
          {data && selected && (
            <>
              <div className="minutes-explorer-controls">
                <label>
                  Chart statistic
                  <select
                    value={stat}
                    onChange={(e) => setStat(e.target.value as Stat)}
                  >
                    {STATS.map((s) => (
                      <option key={s} value={s}>
                        {LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Scenario minutes <strong>{minutes} min</strong>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    step="1"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
              <svg
                viewBox="0 0 560 218"
                role="img"
                aria-label={`${LABELS[stat]} forecast by minutes. At ${minutes} minutes: ${selected.stats[stat].prediction.toFixed(1)}. Shading shows the approximate 80 percent range.`}
              >
                {[0, 0.5, 1].map((fraction) => (
                  <g key={fraction} className="scenario-grid">
                    <line
                      x1="44"
                      x2="516"
                      y1={y(max * fraction)}
                      y2={y(max * fraction)}
                    />
                    <text x="36" y={y(max * fraction) + 4} textAnchor="end">
                      {(max * fraction).toFixed(1)}
                    </text>
                  </g>
                ))}
                <polygon points={band} className="scenario-band" />
                <polyline points={curve} className="scenario-curve" />
                <line
                  x1={x(data.reference.projected_minutes)}
                  x2={x(data.reference.projected_minutes)}
                  y1="28"
                  y2="176"
                  className="scenario-estimate"
                />
                <line
                  x1={x(minutes)}
                  x2={x(minutes)}
                  y1="28"
                  y2="176"
                  className="scenario-selected"
                />
                <circle
                  cx={x(minutes)}
                  cy={y(selected.stats[stat].prediction)}
                  r="5"
                  className="scenario-dot"
                />
                <circle
                  cx={x(current.projected_minutes)}
                  cy={y(current.stats[stat].prediction)}
                  r="5"
                  className="scenario-current"
                />
                {[0, 12, 24, 36, 48].map((m) => (
                  <text key={m} x={x(m)} y="197" textAnchor="middle">
                    {m}
                  </text>
                ))}
                <text x="280" y="215" textAnchor="middle">
                  Minutes played
                </text>
              </svg>
              <p className="scenario-chart-caption">
                Dashed line: estimated{" "}
                {data.reference.projected_minutes.toFixed(1)} min. Hollow dot:
                current forecast. Shading: approximate 80% range, uncalibrated.
              </p>
              <div className="scenario-comparison">
                <div className="scenario-comparison-labels">
                  <span>Statistic</span>
                  <span>
                    Current
                    <br />
                    {current.projected_minutes.toFixed(1)} min
                  </span>
                  <span>
                    Scenario
                    <br />
                    {minutes} min
                  </span>
                  <span>Change</span>
                </div>
                {STATS.map((s) => {
                  const delta =
                    selected.stats[s].prediction - current.stats[s].prediction;
                  return (
                    <div key={s} className="scenario-comparison-row">
                      <span>{LABELS[s]}</span>
                      <span>{current.stats[s].prediction.toFixed(1)}</span>
                      <strong>{selected.stats[s].prediction.toFixed(1)}</strong>
                      <span>
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="scenario-chart-caption">
                Preview only; your saved forecast stays unchanged. To save a
                scenario, set Expected minutes above and generate a prediction.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
