"""Chronological feature rows, partitions, and per-stat model selection."""

from dataclasses import asdict, dataclass

from .artifacts import ArtifactIdentity, ModelArtifact, StatArtifact
from .baseline import TARGET_STATS, Candidate, PregameContext, candidates, make_context
from .learning import CorrectionBackend, CorrectionModel
from .metrics import mean_absolute_error as mae
from .metrics import mean_squared_error
from .metrics import root_mean_squared_error as rmse
from .model import GameLog

MIN_TRAINING_DATES = 50


@dataclass(frozen=True)
class TrainingRow:
    game: GameLog
    context: PregameContext


def training_rows(history: list[GameLog]) -> list[TrainingRow]:
    rows: list[TrainingRow] = []
    for game in history:
        prior = [g for g in history if g.date < game.date]
        if len(prior) >= 5:
            rows.append(TrainingRow(game, make_context(prior, game.date, game.home)))
    return rows


def partitions(rows: list[TrainingRow]):
    dates = sorted({r.game.date for r in rows})
    if len(dates) < MIN_TRAINING_DATES:
        return None
    train_count = min(max(30, int(len(dates) * 0.7)), len(dates) - 20)
    tune_count = min(max(10, int(len(dates) * 0.15)), len(dates) - train_count - 10)
    tune_start = dates[train_count]
    validation_start = dates[train_count + tune_count]
    return (
        [r for r in rows if r.game.date < tune_start],
        [r for r in rows if tune_start <= r.game.date < validation_start],
        [r for r in rows if r.game.date >= validation_start],
    )


def rate(candidate: Candidate, context: PregameContext, stat: str) -> float:
    return candidate.estimate(context, stat) / context.estimated_minutes


def fit(
    backend: CorrectionBackend,
    rows: list[TrainingRow],
    candidate: Candidate,
    stat: str,
    parameter: float,
) -> CorrectionModel:
    return backend.fit(
        [r.context.vector(stat, candidate) for r in rows],
        [
            getattr(r.game, stat) / r.game.minutes - rate(candidate, r.context, stat)
            for r in rows
        ],
        [r.game.minutes for r in rows],
        parameter,
    )


def errors(
    rows: list[TrainingRow],
    candidate: Candidate,
    stat: str,
    model: CorrectionModel | None,
) -> list[float]:
    result: list[float] = []
    for row in rows:
        predicted_rate = rate(candidate, row.context, stat)
        if model is not None:
            predicted_rate += model.predict(row.context.vector(stat, candidate))
        prediction = max(0.0, predicted_rate) * row.context.estimated_minutes
        result.append(prediction - getattr(row.game, stat))
    return result


def train_models(
    rows: list[TrainingRow], identity: ArtifactIdentity, backend: CorrectionBackend
) -> ModelArtifact:
    split = partitions(rows)
    stat_artifacts: dict[str, StatArtifact] = {}
    artifact: ModelArtifact = {
        **identity,
        "training_games": len(rows),
        "stats": stat_artifacts,
        "status": "trained" if split is not None else "insufficient_history",
    }
    if split is None:
        for stat in TARGET_STATS:
            candidate = Candidate("previous_three", "adaptive", 600)
            residuals = errors(rows, candidate, stat, None) if rows else []
            stat_artifacts[stat] = {
                "baseline": asdict(candidate),
                "active": False,
                "model": None,
                "residual_variance": (
                    mean_squared_error(residuals) if residuals else 0.0
                ),
            }
        return artifact
    train, tuning, validation = split
    artifact["evaluation"] = {
        "training_games": len(train),
        "tuning_games": len(tuning),
        "validation_games": len(validation),
        "training_through": train[-1].game.date.isoformat(),
        "tuning_through": tuning[-1].game.date.isoformat(),
        "validation_start": validation[0].game.date.isoformat(),
        "validation_through": validation[-1].game.date.isoformat(),
        "method": "chronological train/tune/validation; target minutes never used as features",
    }
    artifact["stats"] = {
        stat: train_stat(rows, split, stat, backend) for stat in TARGET_STATS
    }
    return artifact


def train_stat(
    rows: list[TrainingRow],
    split: tuple[list[TrainingRow], list[TrainingRow], list[TrainingRow]],
    stat: str,
    backend: CorrectionBackend,
) -> StatArtifact:
    train, tuning, validation = split
    candidate = min(candidates(), key=lambda c: mae(errors(train, c, stat, None)))
    fits = [
        (parameter, fit(backend, train, candidate, stat, parameter))
        for parameter in backend.parameters
    ]
    parameter, _ = min(
        fits, key=lambda item: mae(errors(tuning, candidate, stat, item[1]))
    )
    evaluated_model = fit(backend, train + tuning, candidate, stat, parameter)
    baseline_errors = errors(validation, candidate, stat, None)
    model_errors = errors(validation, candidate, stat, evaluated_model)
    active = mae(model_errors) < mae(baseline_errors) - 1e-9
    final_model = fit(backend, rows, candidate, stat, parameter)
    selected_errors = model_errors if active else baseline_errors
    return {
        "baseline": asdict(candidate),
        "parameter": parameter,
        "active": active,
        "model": final_model.payload(),
        "baseline_mae": mae(baseline_errors),
        "model_mae": mae(model_errors),
        "baseline_rmse": rmse(baseline_errors),
        "model_rmse": rmse(model_errors),
        "residual_variance": mean_squared_error(selected_errors),
    }
