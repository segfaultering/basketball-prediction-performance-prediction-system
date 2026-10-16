import { TARGET_STATS, LABELS } from "./api";
import type { Prediction } from "./api";
import AccuracyGuide from "./AccuracyGuide";

export default function ModelAccuracy({ result }: { result: Prediction }) {
  const evaluation = result.model.evaluation;
  if (result.model.status !== "trained" || !evaluation)
    return (
      <p className="table-note" role="status">
        Validation accuracy is unavailable: more history is needed to train and
        validate corrections. This forecast uses the baseline.
      </p>
    );

  return (
    <section
      className="evaluation-section"
      aria-label="Model validation accuracy"
    >
      <h3>Model validation accuracy</h3>
      <p>
        {evaluation.validation_games} later historical games ·{" "}
        {result.model.cache_hit ? "Saved model reused" : "Training completed"}
        {result.stub_mode ? " · Synthetic data" : ""}
      </p>
      <div className="table-scroll">
        <table>
          <caption>Average error per game (MAE)</caption>
          <thead>
            <tr>
              <th>Stat</th>
              <th>Forecast MAE</th>
              <th>Baseline MAE</th>
              <th>Selected method</th>
            </tr>
          </thead>
          <tbody>
            {TARGET_STATS.map((stat) => {
              const model = result.model.stats[stat];
              const error = model?.active
                ? model.model_mae
                : model?.baseline_mae;
              return (
                <tr key={stat}>
                  <th>{LABELS[stat]}</th>
                  <td>{error === undefined ? "—" : error.toFixed(2)}</td>
                  <td>
                    {model?.baseline_mae === undefined
                      ? "—"
                      : model.baseline_mae.toFixed(2)}
                  </td>
                  <td>{model?.active ? "Learned adjustment" : "Baseline"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AccuracyGuide />
      <p className="table-note">
        These games select whether to use corrections, so this is validation
        evidence, not an untouched test set or guaranteed future accuracy.
        Steals and blocks do not have trained corrections.
      </p>
    </section>
  );
}
