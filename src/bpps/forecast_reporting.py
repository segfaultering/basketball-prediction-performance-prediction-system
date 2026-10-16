"""Forecast decoration and streaming accuracy summaries independent of storage."""

import math
from collections import Counter
from dataclasses import dataclass, field

from .model import STATS


def record_status(record: dict) -> str:
    actual = record["outcome"]
    if actual is None:
        return "pending"
    return "did_not_play" if actual["minutes"] == 0 else "settled"


def decorate_record(record: dict, primary: bool) -> dict:
    status = record_status(record)
    return {
        **record,
        "primary": primary,
        "status": status,
        "errors": {
            stat: round(
                record["prediction"]["stats"][stat]["prediction"]
                - record["outcome"]["stats"][stat],
                3,
            )
            for stat in STATS
        }
        if status == "settled"
        else None,
    }


@dataclass
class AccuracyTotals:
    absolute_error: float = 0.0
    squared_error: float = 0.0
    baseline_error: float = 0.0
    covered: int = 0

    def add(self, prediction: dict, actual: float, baseline: float) -> None:
        error = prediction["prediction"] - actual
        self.absolute_error += abs(error)
        self.squared_error += error * error
        self.baseline_error += abs(baseline - actual)
        low, high = prediction["approximate_80pct_range"]
        self.covered += low <= actual <= high

    def report(self, count: int) -> dict[str, float | None]:
        return {
            "mae": round(self.absolute_error / count, 3) if count else None,
            "rmse": round(math.sqrt(self.squared_error / count), 3) if count else None,
            "baseline_mae": round(self.baseline_error / count, 3) if count else None,
            "range_coverage": round(self.covered / count, 3) if count else None,
        }


@dataclass
class ForecastSummary:
    source: str
    total: int = 0
    first: set[tuple] = field(default_factory=set)
    primary_ids: set[str] = field(default_factory=set)
    counts: Counter[str] = field(default_factory=Counter)
    stats: dict[str, AccuracyTotals] = field(
        default_factory=lambda: {stat: AccuracyTotals() for stat in STATS}
    )

    def add(self, record: dict) -> None:
        self.total += 1
        prediction = record["prediction"]
        key = (
            prediction["player_id"],
            prediction["game_id"],
            prediction["game_date"] if self.source == "stub" else None,
        )
        if key in self.first:
            return
        self.first.add(key)
        self.primary_ids.add(record["id"])
        status = record_status(record)
        self.counts[status] += 1
        if status == "settled":
            for stat, totals in self.stats.items():
                totals.add(
                    prediction["stats"][stat],
                    record["outcome"]["stats"][stat],
                    prediction["baseline"]["stats"][stat],
                )

    def report(self) -> dict:
        return {
            "tracked_games": len(self.first),
            "evaluated_games": self.counts["settled"],
            "pending_games": self.counts["pending"],
            "did_not_play_games": self.counts["did_not_play"],
            "stats": {
                stat: totals.report(self.counts["settled"])
                for stat, totals in self.stats.items()
            },
        }
