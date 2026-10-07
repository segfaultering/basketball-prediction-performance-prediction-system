"""Leakage-safe, recency-weighted per-minute baseline."""

import math
from dataclasses import dataclass
from datetime import date

STATS = ("points", "rebounds", "assists", "steals")


@dataclass(frozen=True)
class GameLog:
    player_id: str
    game_id: str
    date: date
    team: str
    opponent: str
    home: bool
    minutes: float
    points: float
    rebounds: float
    assists: float
    steals: float

    def __post_init__(self):
        if not self.player_id or not self.game_id or not self.team or not self.opponent:
            raise ValueError("Player, game, team and opponent are required")
        for name in ("minutes", *STATS):
            value = getattr(self, name)
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")


def predict(logs, player_id, game_date, opponent, home, minutes=None):
    history = sorted(
        (
            g
            for g in logs
            if g.player_id == str(player_id) and g.date < game_date and g.minutes > 0
        ),
        key=lambda g: g.date,
    )[-60:]
    if len(history) < 5:
        raise ValueError(
            "At least five earlier games with positive minutes are required"
        )
    if minutes is not None and (not math.isfinite(minutes) or not 0 <= minutes <= 48):
        raise ValueError("Projected minutes must be between 0 and 48")
    weights = [0.5 ** ((len(history) - 1 - i) / 10) for i in range(len(history))]
    total = sum(weights)
    projected = (
        minutes
        if minutes is not None
        else min(48, sum(g.minutes * w for g, w in zip(history, weights)) / total)
    )
    output = {}
    for stat in STATS:
        rate = sum(getattr(g, stat) * w for g, w in zip(history, weights)) / sum(
            g.minutes * w for g, w in zip(history, weights)
        )
        # Shrink sparse venue/opponent samples toward the overall rate.
        for subset, strength in [
            ([g for g in history if g.home == home], 20),
            ([g for g in history if g.opponent == opponent], 12),
        ]:
            if subset and rate > 0:
                subset_rate = sum(getattr(g, stat) for g in subset) / sum(
                    g.minutes for g in subset
                )
                ratio = max(0.8, min(1.2, subset_rate / rate))
                rate *= 1 + (ratio - 1) * len(subset) / (len(subset) + strength)
        mean = rate * projected
        variance = (
            sum(
                w * (getattr(g, stat) - rate * g.minutes) ** 2
                for g, w in zip(history, weights)
            )
            / total
        )
        width = 1.282 * math.sqrt(
            max(
                mean,
                variance
                * projected
                / max(1, sum(g.minutes * w for g, w in zip(history, weights)) / total),
            )
        )
        output[stat] = {
            "prediction": round(mean, 2),
            "approximate_80pct_range": [
                round(max(0, mean - width), 2),
                round(mean + width, 2),
            ],
        }
    warnings = [
        "Conditional on playing; injuries, lineups, pace and opponent defense are not modeled.",
        "Ranges are heuristic and have not been calibrated.",
    ]
    if (game_date - history[-1].date).days > 30:
        warnings.append(
            "Latest history is over 30 days old; role and fitness may have changed."
        )
    return {
        "player_id": str(player_id),
        "game_date": game_date.isoformat(),
        "opponent": opponent,
        "home": home,
        "projected_minutes": round(projected, 2),
        "history_games": len(history),
        "last_history_date": history[-1].date.isoformat(),
        "stats": output,
        "warnings": warnings,
    }


def backtest(logs, player_id):
    history = sorted(
        (g for g in logs if g.player_id == str(player_id) and g.minutes > 0),
        key=lambda g: g.date,
    )
    errors = {s: [] for s in STATS}
    baseline = {s: [] for s in STATS}
    coverage = {s: [] for s in STATS}
    for game in history:
        prior = [g for g in history if g.date < game.date]
        if len(prior) < 5:
            continue
        result = predict(prior, player_id, game.date, game.opponent, game.home)
        for stat in STATS:
            actual = getattr(game, stat)
            predicted = result["stats"][stat]
            errors[stat].append(predicted["prediction"] - actual)
            baseline[stat].append(
                sum(getattr(g, stat) for g in prior[-10:]) / len(prior[-10:]) - actual
            )
            low, high = predicted["approximate_80pct_range"]
            coverage[stat].append(low <= actual <= high)
    if not errors["points"]:
        raise ValueError(
            "At least six games on distinct dates are required for backtesting"
        )
    return {
        "player_id": str(player_id),
        "evaluated_games": len(errors["points"]),
        "method": "expanding-window; only earlier dates; minutes estimated from history",
        "stats": {
            s: {
                "mae": round(sum(abs(e) for e in errors[s]) / len(errors[s]), 3),
                "rmse": round(
                    math.sqrt(sum(e * e for e in errors[s]) / len(errors[s])), 3
                ),
                "last_10_mean_mae": round(
                    sum(abs(e) for e in baseline[s]) / len(baseline[s]), 3
                ),
                "range_coverage": round(sum(coverage[s]) / len(coverage[s]), 3),
            }
            for s in STATS
        },
    }
