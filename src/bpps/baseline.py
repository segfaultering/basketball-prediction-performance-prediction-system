"""Shared per-minute blend formulas for research and production."""

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from datetime import date
from typing import Literal, Protocol

from .model import GameLog

TARGET_STATS = ("points", "rebounds", "assists")
RESEARCH_STATS = TARGET_STATS
Window = Literal["career", "previous_three"]


class RateContext(Protocol):
    @property
    def estimated_minutes(self) -> float: ...
    @property
    def season_minutes(self) -> float: ...
    @property
    def season_rates(self) -> dict[str, float] | None: ...
    @property
    def career_rates(self) -> dict[str, float] | None: ...
    @property
    def previous_three_rates(self) -> dict[str, float] | None: ...


def season_start(day: date) -> int:
    """July-to-June labels, consistent with the application."""
    return day.year if day.month >= 7 else day.year - 1


def season_name(start: int) -> str:
    return f"{start}-{(start + 1) % 100:02d}"


def validate_logs(logs: list[GameLog], player_id: str) -> list[GameLog]:
    seen: set[tuple[str, str]] = set()
    for game in logs:
        key = (game.player_id, game.game_id)
        if key in seen:
            raise ValueError(f"Duplicate player/game: {key}")
        seen.add(key)
    history = sorted(
        (g for g in logs if g.player_id == player_id),
        key=lambda g: (g.date, g.game_id),
    )
    if not history:
        raise ValueError(f"No history for player {player_id}")
    return history


def history_digest(logs: list[GameLog]) -> str:
    # CSV ingestion returns floats; equivalent integer inputs must hash identically.
    records = []
    for game in logs:
        record = asdict(game)
        for field in ("minutes", "points", "rebounds", "assists", "steals", "blocks"):
            record[field] = float(record[field])
        records.append(record)
    payload = json.dumps(records, default=str, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def rates(logs: list[GameLog]) -> dict[str, float] | None:
    minutes = sum(g.minutes for g in logs)
    if minutes == 0:
        return None
    return {s: sum(getattr(g, s) for g in logs) / minutes for s in RESEARCH_STATS}


@dataclass(frozen=True)
class Candidate:
    window: Window
    kind: Literal["fixed", "adaptive"]
    value: float

    def __post_init__(self):
        if self.window not in ("career", "previous_three"):
            raise ValueError("Unknown historical window")
        if self.kind not in ("fixed", "adaptive") or not math.isfinite(self.value):
            raise ValueError("Invalid blend parameters")
        if (self.kind == "fixed" and not 0 <= self.value <= 1) or (
            self.kind == "adaptive" and self.value <= 0
        ):
            raise ValueError("Invalid blend weight or adaptation constant")

    @property
    def name(self) -> str:
        return f"{self.window}/{self.kind}/{self.value:g}"

    def season_weight(self, minutes: float) -> float:
        return self.value if self.kind == "fixed" else minutes / (minutes + self.value)

    def estimate(self, features: RateContext, stat: str) -> float:
        historical = (
            features.career_rates
            if self.window == "career"
            else features.previous_three_rates
        )
        current = features.season_rates
        if historical is None and current is None:
            raise ValueError("No rate history available")
        if historical is None:
            assert current is not None
            rate = current[stat]
        elif current is None:
            rate = historical[stat]
        else:
            weight = self.season_weight(features.season_minutes)
            rate = (1 - weight) * historical[stat] + weight * current[stat]
        return rate * features.estimated_minutes


def candidates() -> list[Candidate]:
    """Tie order: recent history, fixed weights ascending, then adaptive k ascending."""
    result: list[Candidate] = []
    for window in ("previous_three", "career"):
        result.extend(Candidate(window, "fixed", v) for v in (0, 0.25, 0.5, 0.75, 1))
        result.extend(Candidate(window, "adaptive", k) for k in (100, 300, 600, 1200))
    return result


@dataclass(frozen=True)
class PregameContext:
    estimated_minutes: float
    season_minutes: float
    season_rates: dict[str, float] | None
    career_rates: dict[str, float] | None
    previous_three_rates: dict[str, float] | None
    last_five_rates: dict[str, float]
    last_ten_rates: dict[str, float]
    last_five_minutes: float
    home: bool
    rest_days: int

    def vector(self, stat: str, candidate: Candidate) -> list[float]:
        baseline_rate = candidate.estimate(self, stat) / self.estimated_minutes
        return [
            baseline_rate,
            self.career_rates[stat] if self.career_rates else baseline_rate,
            self.previous_three_rates[stat]
            if self.previous_three_rates
            else baseline_rate,
            self.season_rates[stat] if self.season_rates else baseline_rate,
            self.last_five_rates[stat],
            self.last_ten_rates[stat],
            self.last_five_rates[stat] - self.last_ten_rates[stat],
            self.estimated_minutes,
            self.last_five_minutes,
            float(self.home),
            float(min(self.rest_days, 30)),
            self.season_minutes / 1000,
        ]


FEATURE_NAMES = (
    "baseline_rate",
    "career_rate",
    "previous_three_rate",
    "season_rate",
    "last_five_rate",
    "last_ten_rate",
    "rate_trend",
    "estimated_minutes",
    "last_five_minutes",
    "home",
    "rest_days_capped_30",
    "season_minutes_thousands",
)


def make_context(
    history: list[GameLog],
    game_date: date,
    home: bool,
) -> PregameContext:
    prior = sorted(
        (g for g in history if g.date < game_date and g.minutes > 0),
        key=lambda g: (g.date, g.game_id),
    )
    if len(prior) < 5:
        raise ValueError(
            "At least five earlier games with positive minutes are required"
        )
    year = season_start(game_date)
    current = [g for g in prior if season_start(g.date) == year]
    past = [g for g in prior if season_start(g.date) < year]
    recent = [g for g in past if season_start(g.date) >= year - 3]
    last = prior[-10:]
    last_five = prior[-5:]
    five_rates = rates(last_five)
    ten_rates = rates(last)
    assert five_rates is not None and ten_rates is not None
    return PregameContext(
        estimated_minutes=min(48.0, sum(g.minutes for g in last) / len(last)),
        season_minutes=sum(g.minutes for g in current),
        season_rates=rates(current),
        career_rates=rates(past),
        previous_three_rates=rates(recent),
        last_five_rates=five_rates,
        last_ten_rates=ten_rates,
        last_five_minutes=sum(g.minutes for g in last_five) / len(last_five),
        home=home,
        rest_days=(game_date - prior[-1].date).days,
    )
