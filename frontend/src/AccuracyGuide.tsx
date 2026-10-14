export default function AccuracyGuide({
  extended = false,
  coverage = false,
}: {
  extended?: boolean;
  coverage?: boolean;
}) {
  return (
    <div className="table-note">
      <p>
        <strong>Average miss (MAE):</strong> How far the forecast was from the
        actual result, on average. A points MAE of 7 means a miss of about 7
        points per game. Lower is better.
      </p>
      <p>
        <strong>Baseline MAE:</strong> The same measure for the starting
        estimate from past production and expected minutes. A lower forecast MAE
        means the forecast improved on that estimate.
      </p>
      {extended && (
        <p>
          <strong>Large-miss score (RMSE):</strong> Gives extra weight to big
          misses. Lower is better; a much higher RMSE than MAE suggests some
          games had especially large errors.
        </p>
      )}
      {coverage && (
        <p>
          <strong>Range coverage:</strong> The percentage of actual results
          inside the forecast’s approximate 80% range. The range has not been
          calibrated, so 80% coverage is not guaranteed.
        </p>
      )}
    </div>
  );
}
