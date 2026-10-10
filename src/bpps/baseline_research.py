"""Notebook experiments; deliberately separate from application predictions."""

import csv
import hashlib
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Literal, TypedDict

from .baseline import (
    TARGET_STATS,
    Candidate,
    candidates,
    history_digest,
    rates,
    season_name,
    season_start,
    validate_logs,
)
from .data import NBAClient, read_logs
from .model import GameLog, predict
from .settings import PROJECT_ROOT

RESEARCH_STATS = TARGET_STATS

DEFAULT_CACHE = PROJECT_ROOT / ".cache" / "bpps" / "research"
Source = Literal["nba", "csv", "synthetic"]


def synthetic_history(player_id: str, start: int, end: int) -> list[GameLog]:
    """Deterministic multi-season fixture with changing minutes and production."""
    logs: list[GameLog] = []
    for year in range(start, end + 1):
        for i in range(60):
            minutes = float(26 + i % 11)
            trend = (year - start) * 0.006
            logs.append(
                GameLog(
                    player_id=player_id,
                    game_id=f"synthetic-{year}-{i}",
                    date=date(year, 10, 20) + timedelta(days=i * 3),
                    team="GSW",
                    opponent=("BOS", "LAL", "NYK")[i % 3],
                    home=i % 2 == 0,
                    minutes=0.0 if i == 17 else minutes,
                    points=float(round(minutes * (0.65 + trend) + i % 9 - 4)),
                    rebounds=float(round(minutes * 0.15 + i % 5 - 2)),
                    assists=float(round(minutes * (0.18 + trend / 2) + i % 5 - 2)),
                    steals=float(i % 3),
                    blocks=float(i % 2),
                )
            )
    return logs


@dataclass(frozen=True)
class Dataset:
    logs: list[GameLog]
    player_id: str
    source: Source
    requested_seasons: list[str]
    sha256: str

    def summary(self) -> list[dict[str, str | int]]:
        counts = Counter(season_name(season_start(g.date)) for g in self.logs)
        positive = Counter(
            season_name(season_start(g.date)) for g in self.logs if g.minutes > 0
        )
        return [
            {"season": s, "appearances": counts[s], "positive_minutes": positive[s]}
            for s in self.requested_seasons
        ]


def load_history(
    player_id: str = "201939",
    start: int = 2009,
    end: int = 2025,
    source: Source = "nba",
    csv_path: Path | None = None,
    refresh: bool = False,
    cache_dir: Path = DEFAULT_CACHE,
) -> Dataset:
    """Load an explicit data source. Complete NBA snapshots survive the HTTP TTL."""
    if not player_id or start > end:
        raise ValueError("Provide a player ID and an ordered season range")
    seasons = [season_name(y) for y in range(start, end + 1)]
    if source == "synthetic":
        logs = synthetic_history(player_id, start, end)
    elif source == "csv":
        if csv_path is None:
            raise ValueError("CSV mode requires csv_path")
        logs = read_logs(csv_path)
    elif source == "nba":
        key = hashlib.sha256(
            json.dumps([player_id, seasons, "Regular Season"]).encode()
        ).hexdigest()[:16]
        snapshot = cache_dir / f"history-{key}.csv"
        manifest = cache_dir / f"history-{key}.json"
        cached: list[GameLog] | None = None
        if not refresh and snapshot.exists() and manifest.exists():
            try:
                candidate = validate_logs(read_logs(snapshot), player_id)
                metadata = json.loads(manifest.read_text())
                if (
                    metadata["player_id"] == player_id
                    and metadata["seasons"] == seasons
                    and metadata["sha256"] == history_digest(candidate)
                ):
                    cached = candidate
            except ValueError, OSError, KeyError, TypeError:
                cached = None
        if cached is not None:
            logs = cached
        else:
            client = NBAClient(cache_dir / "nba", refresh=refresh)
            logs = []
            for season in seasons:
                try:
                    logs.extend(client.logs(player_id, season, "Regular Season"))
                except (ValueError, OSError, KeyError, TypeError) as exc:
                    raise ValueError(
                        f"Incomplete NBA download at {season}; no research snapshot "
                        f"was saved. Retry or explicitly use CSV/synthetic mode. {exc}"
                    ) from exc
            logs = validate_logs(logs, player_id)
            cache_dir.mkdir(parents=True, exist_ok=True)
            with snapshot.open("w", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=list(asdict(logs[0])))
                writer.writeheader()
                writer.writerows(asdict(g) for g in logs)
            manifest.write_text(
                json.dumps(
                    {
                        "player_id": player_id,
                        "seasons": seasons,
                        "season_type": "Regular Season",
                        "sha256": history_digest(logs),
                    },
                    indent=2,
                )
            )
    else:
        raise ValueError(f"Unknown source: {source}")
    logs = validate_logs(logs, player_id)
    logs = [g for g in logs if start <= season_start(g.date) <= end]
    if not logs:
        raise ValueError("No history within the requested seasons")
    return Dataset(logs, player_id, source, seasons, history_digest(logs))


@dataclass(frozen=True)
class Features:
    game: GameLog
    estimated_minutes: float
    season_minutes: float
    season_rates: dict[str, float] | None
    career_rates: dict[str, float] | None
    previous_three_rates: dict[str, float] | None
    last_ten: dict[str, float]
    existing: dict[str, float]
    existing_minutes: float


def build_features(logs: list[GameLog], player_id: str) -> list[Features]:
    history = [g for g in validate_logs(logs, player_id) if g.minutes > 0]
    features: list[Features] = []
    for game in history:
        prior = [g for g in history if g.date < game.date]
        if len(prior) < 5:
            continue
        year = season_start(game.date)
        current = [g for g in prior if season_start(g.date) == year]
        past = [g for g in prior if season_start(g.date) < year]
        recent = [g for g in past if season_start(g.date) >= year - 3]
        last = prior[-10:]
        existing = predict(prior, player_id, game.date, game.opponent, game.home)
        features.append(
            Features(
                game=game,
                estimated_minutes=min(48.0, sum(g.minutes for g in last) / len(last)),
                season_minutes=sum(g.minutes for g in current),
                season_rates=rates(current),
                career_rates=rates(past),
                previous_three_rates=rates(recent),
                last_ten={
                    s: sum(getattr(g, s) for g in last) / len(last)
                    for s in RESEARCH_STATS
                },
                existing={
                    s: existing["stats"][s]["prediction"] for s in RESEARCH_STATS
                },
                existing_minutes=existing["projected_minutes"],
            )
        )
    return features


class Score(TypedDict):
    stat: str
    method: str
    mae: float
    rmse: float
    evaluated_games: int


def score(stat: str, method: str, errors: list[float]) -> Score:
    if not errors:
        raise ValueError("No eligible evaluation games")
    return {
        "stat": stat,
        "method": method,
        "mae": sum(abs(e) for e in errors) / len(errors),
        "rmse": math.sqrt(sum(e * e for e in errors) / len(errors)),
        "evaluated_games": len(errors),
    }


def select_candidates(
    features: list[Features], tuning_seasons: tuple[int, ...]
) -> tuple[dict[str, Candidate], list[Score]]:
    tuning = [f for f in features if season_start(f.game.date) in tuning_seasons]
    for year in tuning_seasons:
        if not any(season_start(f.game.date) == year for f in tuning):
            raise ValueError(f"No eligible tuning games in {season_name(year)}")
    grid = candidates()
    selected: dict[str, Candidate] = {}
    table: list[Score] = []
    for stat in RESEARCH_STATS:
        scored = [
            score(
                stat,
                c.name,
                [c.estimate(f, stat) - getattr(f.game, stat) for f in tuning],
            )
            for c in grid
        ]
        # min preserves the fixed candidate order when MAEs are identical.
        winner = min(range(len(grid)), key=lambda i: scored[i]["mae"])
        selected[stat] = grid[winner]
        table.extend(scored)
        for method in ("existing", "last_ten"):
            table.append(
                score(
                    stat,
                    method,
                    [getattr(f, method)[stat] - getattr(f.game, stat) for f in tuning],
                )
            )
    return selected, table


class PredictionRow(TypedDict):
    date: str
    game_id: str
    stat: str
    method: str
    actual: float
    prediction: float
    actual_minutes: float
    estimated_minutes: float
    existing_minutes: float
    career_rate: float | None
    previous_three_rate: float | None
    season_rate: float | None


@dataclass(frozen=True)
class Experiment:
    selected: dict[str, Candidate]
    tuning_scores: list[Score]
    holdout_scores: list[Score]
    predictions: list[PredictionRow]
    minutes_scores: list[Score]
    tuning_seasons: tuple[int, ...]
    holdout_season: int


def run_experiment(
    dataset: Dataset,
    tuning_seasons: tuple[int, ...] = (2023, 2024),
    holdout_season: int = 2025,
) -> Experiment:
    if not tuning_seasons or max(tuning_seasons) >= holdout_season:
        raise ValueError("Tuning seasons must precede the holdout season")
    # Select before computing holdout features or reading holdout outcomes.
    tuning_logs = [
        g for g in dataset.logs if season_start(g.date) <= max(tuning_seasons)
    ]
    if not tuning_logs:
        raise ValueError("No eligible tuning games in the requested periods")
    selected, tuning_scores = select_candidates(
        build_features(tuning_logs, dataset.player_id), tuning_seasons
    )
    holdout_features = [
        f
        for f in build_features(dataset.logs, dataset.player_id)
        if season_start(f.game.date) == holdout_season
    ]
    if not holdout_features:
        raise ValueError(f"No eligible holdout games in {season_name(holdout_season)}")
    rows: list[PredictionRow] = []
    holdout_scores: list[Score] = []
    for stat in RESEARCH_STATS:
        for method in ("selected_blend", "existing", "last_ten"):
            errors: list[float] = []
            for f in holdout_features:
                estimate = (
                    selected[stat].estimate(f, stat)
                    if method == "selected_blend"
                    else getattr(f, method)[stat]
                )
                actual = getattr(f.game, stat)
                errors.append(estimate - actual)
                rows.append(
                    {
                        "date": f.game.date.isoformat(),
                        "game_id": f.game.game_id,
                        "stat": stat,
                        "method": method,
                        "actual": actual,
                        "prediction": estimate,
                        "actual_minutes": f.game.minutes,
                        "estimated_minutes": f.estimated_minutes,
                        "existing_minutes": f.existing_minutes,
                        "career_rate": f.career_rates[stat] if f.career_rates else None,
                        "previous_three_rate": (
                            f.previous_three_rates[stat]
                            if f.previous_three_rates
                            else None
                        ),
                        "season_rate": f.season_rates[stat] if f.season_rates else None,
                    }
                )
            holdout_scores.append(score(stat, method, errors))
    minutes_scores = [
        score(
            "minutes",
            method,
            [getattr(f, method) - f.game.minutes for f in holdout_features],
        )
        for method in ("estimated_minutes", "existing_minutes")
    ]
    return Experiment(
        selected,
        tuning_scores,
        holdout_scores,
        rows,
        minutes_scores,
        tuning_seasons,
        holdout_season,
    )


def save_results(
    dataset: Dataset, experiment: Experiment, cache_dir: Path = DEFAULT_CACHE
) -> Path:
    """Store parameters, data identity and unrounded metrics for reproducibility."""
    key = hashlib.sha256(
        json.dumps(
            [dataset.sha256, experiment.tuning_seasons, experiment.holdout_season]
        ).encode()
    ).hexdigest()[:16]
    output = cache_dir / f"results-{key}"
    output.mkdir(parents=True, exist_ok=True)
    metadata = {
        "experiment_version": 1,
        "source": dataset.source,
        "player_id": dataset.player_id,
        "dataset_sha256": dataset.sha256,
        "requested_seasons": dataset.requested_seasons,
        "season_counts": dataset.summary(),
        **asdict(experiment),
    }
    (output / "results.json").write_text(json.dumps(metadata, indent=2))
    with (output / "holdout_predictions.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(experiment.predictions[0]))
        writer.writeheader()
        writer.writerows(experiment.predictions)
    return output
