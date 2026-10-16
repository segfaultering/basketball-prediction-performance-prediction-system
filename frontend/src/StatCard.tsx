import { ABBREVIATIONS, LABELS } from "./api";
import { ArrowDownRight, ArrowUpRight, Check } from "lucide-react";
import type { Prediction, Stat } from "./api";

const number = (value: number) => value.toFixed(1);

export default function StatCard({
  stat,
  result,
}: {
  stat: Stat;
  result: Prediction | null;
}) {
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
        <span className="stat-abbreviation">{ABBREVIATIONS[stat]}</span>
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
            80% range (approx.)
          </>
        ) : (
          "No prediction"
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
