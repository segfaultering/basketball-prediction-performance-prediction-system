"""Prepared inference shared by individual forecasts and minutes scenarios."""

import math
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from typing import Any

from .artifacts import ModelArtifact, model_summary
from .baseline import FEATURE_NAMES, TARGET_STATS, Candidate, PregameContext
from .learning import CorrectionBackend
from .model import GameLog, StatRate, legacy_rates


@dataclass(frozen=True)
class PreparedForecast:
    estimated_minutes: float
    rates: dict[str, StatRate]
    metadata: dict[str, Any]
    parameters: dict[str, Any]

    def prediction(self, minutes: float | None = None) -> dict[str, Any]:
        if minutes is not None and (
            not math.isfinite(minutes) or not 0 <= minutes <= 48
        ):
            raise ValueError("Projected minutes must be between 0 and 48")
        projected = self.estimated_minutes if minutes is None else minutes
        stats = {stat: rate.estimate(projected) for stat, rate in self.rates.items()}
        baselines = {
            stat: estimate.get("baseline_prediction", estimate["prediction"])
            for stat, estimate in stats.items()
        }
        return {
            **deepcopy(self.metadata),
            "projected_minutes": round(projected, 2),
            "stats": stats,
            "baseline": {
                "method": "historical/season per-minute blend × expected minutes",
                "stats": baselines,
                "parameters": deepcopy(self.parameters),
            },
        }

    def minute_scenarios(self) -> dict[str, Any]:
        def scenario(minutes: float | None):
            forecast = self.prediction(minutes)
            return {
                "projected_minutes": forecast["projected_minutes"],
                "stats": forecast["stats"],
            }

        return {
            "reference": scenario(None),
            "scenarios": [scenario(minutes) for minutes in range(49)],
        }


def prepare_forecast(
    history: list[GameLog],
    player_id: str,
    game_date: date,
    opponent: str,
    home: bool,
    context: PregameContext,
    artifact: ModelArtifact,
    backend: CorrectionBackend,
) -> PreparedForecast:
    rates: dict[str, StatRate] = {}
    for stat in TARGET_STATS:
        entry = artifact["stats"][stat]
        candidate = Candidate(**entry["baseline"])
        baseline = candidate.estimate(context, stat) / context.estimated_minutes
        correction = 0.0
        if entry["active"]:
            assert entry["model"] is not None
            model = backend.restore(entry["model"], len(FEATURE_NAMES))
            correction = model.predict(context.vector(stat, candidate))
        rates[stat] = StatRate(
            baseline + correction,
            entry["residual_variance"],
            context.estimated_minutes,
            baseline,
        )
    rates.update(legacy_rates(history, opponent, home, ("steals", "blocks")))
    warnings = [
        "Conditional on playing; injuries, lineups, pace and current opponent defense are not modeled.",
        "Ranges are heuristic and have not been calibrated.",
    ]
    if artifact["status"] == "insufficient_history":
        warnings.append(
            "Not enough history for chronological model validation; using the blended baseline."
        )
    if (game_date - history[-1].date).days > 30:
        warnings.append(
            "Latest history is over 30 days old; production and minutes may have changed."
        )
    return PreparedForecast(
        context.estimated_minutes,
        rates,
        {
            "player_id": player_id,
            "game_date": game_date.isoformat(),
            "opponent": opponent,
            "home": home,
            "history_games": len(history),
            "last_history_date": history[-1].date.isoformat(),
            "model": model_summary(artifact),
            "warnings": warnings,
        },
        {stat: artifact["stats"][stat]["baseline"] for stat in TARGET_STATS},
    )
