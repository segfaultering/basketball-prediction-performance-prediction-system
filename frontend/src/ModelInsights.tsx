import { TARGET_STATS, LABELS, STATS } from "./api";
import type { DataMode } from "./api";
import { Activity, BarChart3, LoaderCircle } from "lucide-react";
import { ErrorNotice } from "./WorkflowUi";
import AccuracyGuide from "./AccuracyGuide";
import type { PredictionWorkflow } from "./usePredictionWorkflow";
const number = (value: number) => value.toFixed(1);

export default function ModelInsights({
  workflow,
  mode,
}: {
  workflow: PredictionWorkflow;
  mode: DataMode;
}) {
  const { player, result, backtest, backtestBusy, backtestError, evaluate } =
    workflow;
  return (
    <div className="insights-panel panel">
      <div className="insights-intro">
        <BarChart3 size={22} />
        <div>
          <h3>Validation: choosing the forecast method</h3>
          <p>
            The baseline is a starting estimate from past stats and expected
            minutes. A learned adjustment (correction) is used only when it
            lowers the average miss on later historical games.
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
                {TARGET_STATS.map((s) => {
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
                          {model?.active ? "Correction" : "Baseline"}
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
            These games help choose the method, so their errors are not an
            independent test of future accuracy. Points, rebounds, and assists
            can use corrections; steals and blocks use the baseline.
          </p>
        </>
      ) : (
        <p className="table-note">
          Generate a prediction to see this player’s validation results.
        </p>
      )}
      <div className="evaluation-section">
        <h3>Backtest: test predictions on past games</h3>
        <p>
          For each past game, rebuild a forecast using only games played before
          it, then compare with the actual stats. This shows how the forecasting
          process would have performed as the player’s history grew.
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
          {backtestBusy ? "Evaluating past games…" : "Run backtest"}
        </button>
        {backtestError && <ErrorNotice message={backtestError} />}
        {backtest && (
          <>
            {backtest.evaluation_scope && (
              <p className="table-note">{backtest.evaluation_scope}</p>
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
                      <td>{number(backtest.stats[s].blended_baseline_mae)}</td>
                      <td>{number(backtest.stats[s].rmse)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AccuracyGuide extended />
            <p className="table-note">
              Historical results help assess the forecast, but do not guarantee
              the same accuracy in future games.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
