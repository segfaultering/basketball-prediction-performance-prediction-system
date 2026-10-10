import { useEffect, useRef, useState } from "react";
import { LABELS, STATS, prettyDate, request } from "./api";
import type { ForecastHistory, ForecastRefresh } from "./api";

const value = (number: number | null | undefined) =>
  number == null ? "—" : number.toFixed(1);
const pageSize = 20;

export default function ForecastTracking() {
  const [history, setHistory] = useState<ForecastHistory | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    request<ForecastHistory>(
      `/forecasts?limit=${pageSize}&offset=${offset}`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Cannot load forecast history.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [offset, revision]);

  useEffect(() => () => refreshAbort.current?.abort(), []);

  async function refreshResults() {
    const controller = new AbortController();
    refreshAbort.current?.abort();
    refreshAbort.current = controller;
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      const result = await request<ForecastRefresh>(
        "/forecasts/refresh",
        controller.signal,
        {},
      );
      if (controller.signal.aborted) return;
      setNotice(`Updated ${result.updated_forecasts} forecast records.`);
      setError(
        result.errors
          .map((e) => `${e.player_id} (${e.season}): ${e.detail}`)
          .join("; "),
      );
      setOffset(0);
      setRevision((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Cannot refresh results.");
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }

  return (
    <section className="tracking-section" aria-label="Saved forecasts">
      <div className="section-heading">
        <div>
          <h2>Results</h2>
          <p>Saved forecasts and final stats.</p>
        </div>
        <div className="tracking-actions">
          <button
            className="today-button"
            disabled={busy || refreshing}
            onClick={() => {
              setError("");
              setRevision((n) => n + 1);
            }}
          >
            Reload history
          </button>
          <button
            className="today-button"
            disabled={busy || refreshing || !history?.total}
            onClick={refreshResults}
          >
            {refreshing ? "Refreshing results…" : "Refresh results"}
          </button>
        </div>
      </div>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading saved forecasts…</p>}
      {history?.stub_mode && (
        <p className="synthetic-notice">
          Synthetic forecast history. These results do not measure NBA accuracy.
        </p>
      )}
      {history && (
        <>
          <div className="tracking-counts">
            <span>
              <strong>{history.summary.tracked_games}</strong> tracked games
            </span>
            <span>
              <strong>{history.summary.evaluated_games}</strong> evaluated
            </span>
            <span>
              <strong>{history.summary.pending_games}</strong> pending
            </span>
            <span>
              <strong>{history.summary.did_not_play_games}</strong> did not play
            </span>
          </div>
          <details className="prediction-details">
            <summary>How accuracy is measured</summary>
            <p>
              Accuracy uses the first forecast per player/game. Later scenarios
              remain in history. Confirmed zero-minute appearances are excluded;
              missing game logs remain pending.
            </p>
          </details>
          {history.summary.evaluated_games > 0 ? (
            <div className="table-scroll">
              <table className="tracking-table">
                <caption>Saved forecast accuracy</caption>
                <thead>
                  <tr>
                    <th>Stat</th>
                    <th>MAE</th>
                    <th>Baseline MAE</th>
                    <th>RMSE</th>
                    <th>Range coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {STATS.map((stat) => {
                    const metric = history.summary.stats[stat];
                    return (
                      <tr key={stat}>
                        <th>{LABELS[stat]}</th>
                        <td>{value(metric.mae)}</td>
                        <td>{value(metric.baseline_mae)}</td>
                        <td>{value(metric.rmse)}</td>
                        <td>
                          {metric.range_coverage == null
                            ? "—"
                            : `${Math.round(metric.range_coverage * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="table-note">No results yet.</p>
          )}
          {!history.total && (
            <div className="schedule-empty">
              No saved forecasts yet. Generate a prediction to start tracking.
            </div>
          )}
          <div className="tracking-records">
            {history.forecasts.map((record) => (
              <details className="tracking-record panel" key={record.id}>
                <summary>
                  <span>
                    <strong>
                      {record.prediction.player_name ||
                        record.prediction.player_id}
                    </strong>{" "}
                    · {record.prediction.team} vs {record.prediction.opponent}
                    <small>
                      {prettyDate(record.prediction.game_date)} ·{" "}
                      {record.primary
                        ? "First forecast"
                        : "Additional scenario"}
                    </small>
                  </span>
                  <span>
                    {record.status === "pending"
                      ? "Pending result"
                      : record.status === "did_not_play"
                        ? "Did not play"
                        : "Result available"}
                  </span>
                </summary>
                <p className="table-note">
                  Saved {new Date(record.created_at).toLocaleString()} ·{" "}
                  {record.inputs.season_type} ·{" "}
                  {value(record.prediction.projected_minutes)} expected minutes
                  {record.outcome &&
                    ` · ${value(record.outcome.minutes)} actual minutes`}
                </p>
                <div className="table-scroll">
                  <table className="tracking-table">
                    <caption>
                      Forecast versus actual for{" "}
                      {record.prediction.player_name ||
                        record.prediction.player_id}
                    </caption>
                    <thead>
                      <tr>
                        <th>Stat</th>
                        <th>Forecast</th>
                        <th>Baseline</th>
                        <th>Actual</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {STATS.map((stat) => (
                        <tr key={stat}>
                          <th>{LABELS[stat]}</th>
                          <td>
                            {value(record.prediction.stats[stat].prediction)}
                          </td>
                          <td>
                            {value(record.prediction.baseline.stats[stat])}
                          </td>
                          <td>{value(record.outcome?.stats[stat])}</td>
                          <td>{value(record.errors?.[stat])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="prediction-details">
                  <summary>Inputs & model</summary>
                  <pre>
                    {JSON.stringify(
                      { inputs: record.inputs, prediction: record.prediction },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </details>
            ))}
          </div>
          {history.total > pageSize && (
            <div className="tracking-actions">
              <button
                className="today-button"
                disabled={offset === 0 || busy || refreshing}
                onClick={() => {
                  setError("");
                  setOffset((n) => Math.max(0, n - pageSize));
                }}
              >
                Newer forecasts
              </button>
              <span>
                {offset + 1}–{Math.min(offset + pageSize, history.total)} of{" "}
                {history.total}
              </span>
              <button
                className="today-button"
                disabled={
                  offset + pageSize >= history.total || busy || refreshing
                }
                onClick={() => {
                  setError("");
                  setOffset((n) => n + pageSize);
                }}
              >
                Older forecasts
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
