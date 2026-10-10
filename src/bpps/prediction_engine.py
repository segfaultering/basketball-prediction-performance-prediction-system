"""Per-player blended baselines, chronological training, and model reuse."""

import hashlib
import json
import math
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from threading import Lock
from typing import Any

from .baseline import (
    FEATURE_NAMES,
    TARGET_STATS,
    Candidate,
    PregameContext,
    candidates,
    history_digest,
    make_context,
    validate_logs,
)
from .learning import CorrectionBackend, CorrectionModel, create_backend
from .model import STATS, GameLog
from .model import predict as legacy_predict

SCHEMA_VERSION = 1
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


def mae(values: list[float]) -> float:
    return sum(abs(v) for v in values) / len(values)


def rmse(values: list[float]) -> float:
    return math.sqrt(sum(v * v for v in values) / len(values))


class PredictionEngine:
    def __init__(
        self,
        cache_dir: Path | None,
        source: str = "nba",
        season_type: str = "Regular Season",
        backend: CorrectionBackend | None = None,
    ):
        self.cache_dir = cache_dir
        self.source = source
        self.season_type = season_type
        self.backend = backend if backend is not None else create_backend("ridge")
        self.lock = Lock()

    def _identity(self, history: list[GameLog]) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "backend": self.backend.identity,
            "backend_parameters": list(self.backend.parameters),
            "features": list(FEATURE_NAMES),
            "source": self.source,
            "season_type": self.season_type,
            "player_id": history[0].player_id,
            "history_sha256": history_digest(history),
            "trained_through": history[-1].date.isoformat(),
        }

    def _check(self, artifact: dict[str, Any], identity: dict[str, Any]) -> None:
        if not isinstance(artifact, dict):
            raise TypeError("Expected an artifact object")
        if any(artifact.get(k) != v for k, v in identity.items()):
            raise ValueError("Incompatible model artifact")
        if set(artifact["stats"]) != set(TARGET_STATS):
            raise ValueError("Incomplete model artifact")
        for stat in TARGET_STATS:
            entry = artifact["stats"][stat]
            Candidate(**entry["baseline"])
            if type(entry["active"]) is not bool:
                raise ValueError("Invalid activation flag")
            if (
                not math.isfinite(entry["residual_variance"])
                or entry["residual_variance"] < 0
            ):
                raise ValueError("Invalid residual variance")
            if entry["model"] is not None:
                if entry["parameter"] not in self.backend.parameters:
                    raise ValueError("Incompatible training parameters")
                self.backend.restore(entry["model"], len(FEATURE_NAMES))
                for name in (
                    "baseline_mae",
                    "model_mae",
                    "baseline_rmse",
                    "model_rmse",
                ):
                    if not math.isfinite(entry[name]) or entry[name] < 0:
                        raise ValueError("Invalid validation metrics")
            elif entry["active"]:
                raise ValueError("Active model has no fitted parameters")

    def _train(
        self, rows: list[TrainingRow], identity: dict[str, Any]
    ) -> dict[str, Any]:
        split = partitions(rows)
        stat_artifacts: dict[str, dict[str, Any]] = {}
        artifact = {
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
                        sum(e * e for e in residuals) / len(residuals)
                        if residuals
                        else 0.0
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
        for stat in TARGET_STATS:
            candidate = min(
                candidates(), key=lambda c: mae(errors(train, c, stat, None))
            )
            fits = [
                (parameter, fit(self.backend, train, candidate, stat, parameter))
                for parameter in self.backend.parameters
            ]
            parameter, _ = min(
                fits, key=lambda item: mae(errors(tuning, candidate, stat, item[1]))
            )
            evaluated_model = fit(
                self.backend, train + tuning, candidate, stat, parameter
            )
            baseline_errors = errors(validation, candidate, stat, None)
            model_errors = errors(validation, candidate, stat, evaluated_model)
            active = mae(model_errors) < mae(baseline_errors) - 1e-9
            final_model = fit(self.backend, rows, candidate, stat, parameter)
            selected_errors = model_errors if active else baseline_errors
            stat_artifacts[stat] = {
                "baseline": asdict(candidate),
                "parameter": parameter,
                "active": active,
                "model": final_model.payload(),
                "baseline_mae": mae(baseline_errors),
                "model_mae": mae(model_errors),
                "baseline_rmse": rmse(baseline_errors),
                "model_rmse": rmse(model_errors),
                "residual_variance": sum(e * e for e in selected_errors)
                / len(selected_errors),
            }
        return artifact

    def train(
        self, logs: list[GameLog], player_id: str, as_of: date, refresh: bool = False
    ) -> dict[str, Any]:
        history = [
            g
            for g in validate_logs(logs, player_id)
            if g.minutes > 0 and g.date < as_of
        ]
        if len(history) < 5:
            raise ValueError(
                "At least five earlier games with positive minutes are required"
            )
        identity = self._identity(history)
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        path = self.cache_dir / f"{key}.json" if self.cache_dir is not None else None
        with self.lock:
            if path is not None and path.exists() and not refresh:
                try:
                    artifact = json.loads(path.read_text())
                    self._check(artifact, identity)
                    artifact["cache_hit"] = True
                    return artifact
                except ValueError, TypeError, KeyError, OSError:
                    pass  # Invalid artifacts are rebuilt from history.
            artifact = self._train(training_rows(history), identity)
            artifact["cache_hit"] = False
            if path is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(
                    "w", dir=path.parent, delete=False
                ) as stream:
                    temporary = Path(stream.name)
                    try:
                        json.dump(artifact, stream, allow_nan=False)
                        stream.close()
                        os.replace(temporary, path)
                    finally:
                        temporary.unlink(missing_ok=True)
            return artifact

    def prediction(
        self,
        logs: list[GameLog],
        player_id: str,
        game_date: date,
        opponent: str,
        home: bool,
        minutes: float | None = None,
    ) -> dict[str, Any]:
        if minutes is not None and (
            not math.isfinite(minutes) or not 0 <= minutes <= 48
        ):
            raise ValueError("Projected minutes must be between 0 and 48")
        history = [
            g
            for g in validate_logs(logs, player_id)
            if g.minutes > 0 and g.date < game_date
        ]
        context = make_context(history, game_date, home)
        artifact = self.train(history, player_id, game_date)
        return self._forecast(
            history, player_id, game_date, opponent, home, minutes, context, artifact
        )

    def _forecast(
        self,
        history: list[GameLog],
        player_id: str,
        game_date: date,
        opponent: str,
        home: bool,
        minutes: float | None,
        context: PregameContext,
        artifact: dict[str, Any],
    ) -> dict[str, Any]:
        projected = context.estimated_minutes if minutes is None else minutes
        result = legacy_predict(
            history, player_id, game_date, opponent, home, projected
        )
        result["history_games"] = len(history)
        baselines: dict[str, float] = {}
        for stat in TARGET_STATS:
            entry = artifact["stats"][stat]
            candidate = Candidate(**entry["baseline"])
            base_rate = rate(candidate, context, stat)
            correction = 0.0
            if entry["active"]:
                model = self.backend.restore(entry["model"], len(FEATURE_NAMES))
                correction = model.predict(context.vector(stat, candidate))
            mean = max(0.0, base_rate + correction) * projected
            width = 1.282 * math.sqrt(
                max(
                    mean,
                    entry["residual_variance"] * projected / context.estimated_minutes,
                )
            )
            baseline_prediction = base_rate * projected
            baselines[stat] = round(baseline_prediction, 2)
            result["stats"][stat] = {
                "prediction": round(mean, 2),
                "baseline_prediction": round(baseline_prediction, 2),
                "model_correction": round(mean - baseline_prediction, 2),
                "approximate_80pct_range": [
                    round(max(0.0, mean - width), 2),
                    round(mean + width, 2),
                ],
            }
        for stat in ("steals", "blocks"):
            baselines[stat] = result["stats"][stat]["prediction"]
        result["baseline"] = {
            "method": "historical/season per-minute blend × expected minutes",
            "stats": baselines,
            "parameters": {s: artifact["stats"][s]["baseline"] for s in TARGET_STATS},
        }
        model_summary = {
            k: v
            for k, v in artifact.items()
            if k not in ("stats", "features", "backend_parameters")
        }
        model_summary["stats"] = {
            s: {
                k: v
                for k, v in artifact["stats"][s].items()
                if k not in ("model", "residual_variance")
            }
            for s in TARGET_STATS
        }
        result["model"] = model_summary
        result["warnings"] = [
            "Conditional on playing; injuries, lineups, pace and current opponent defense are not modeled.",
            "Ranges are heuristic and have not been calibrated.",
        ]
        if artifact["status"] == "insufficient_history":
            result["warnings"].append(
                "Not enough history for chronological model validation; using the blended baseline."
            )
        if (game_date - history[-1].date).days > 30:
            result["warnings"].append(
                "Latest history is over 30 days old; production and minutes may have changed."
            )
        return result

    def backtest(self, logs: list[GameLog], player_id: str) -> dict[str, Any]:
        history = [g for g in validate_logs(logs, player_id) if g.minutes > 0]
        rows = training_rows(history)
        if not rows:
            raise ValueError(
                "At least six games on distinct dates are required for backtesting"
            )
        all_errors: dict[str, list[float]] = {s: [] for s in STATS}
        baseline_errors: dict[str, list[float]] = {s: [] for s in STATS}
        last_ten_errors: dict[str, list[float]] = {s: [] for s in STATS}
        coverage: dict[str, list[bool]] = {s: [] for s in STATS}
        # No disk artifacts during historical evaluation, and no future-fitted models.
        evaluator = PredictionEngine(None, self.source, self.season_type, self.backend)
        for row in rows:
            game = row.game
            prior = [g for g in history if g.date < game.date]
            # Reuse precomputed, strictly-pregame features instead of rebuilding
            # the entire training dataset for each historical target.
            earlier_rows = [r for r in rows if r.game.date < game.date]
            artifact = evaluator._train(earlier_rows, evaluator._identity(prior))
            artifact["cache_hit"] = False
            prediction = evaluator._forecast(
                prior,
                player_id,
                game.date,
                game.opponent,
                game.home,
                None,
                row.context,
                artifact,
            )
            for stat in STATS:
                actual = getattr(game, stat)
                all_errors[stat].append(
                    prediction["stats"][stat]["prediction"] - actual
                )
                baseline_errors[stat].append(
                    prediction["baseline"]["stats"][stat] - actual
                )
                last_ten_errors[stat].append(
                    sum(getattr(g, stat) for g in prior[-10:]) / len(prior[-10:])
                    - actual
                )
                low, high = prediction["stats"][stat]["approximate_80pct_range"]
                coverage[stat].append(low <= actual <= high)
        return {
            "player_id": player_id,
            "evaluated_games": len(rows),
            "method": "expanding-window; baseline selection and model training only on earlier dates",
            "stats": {
                s: {
                    "mae": round(mae(all_errors[s]), 3),
                    "rmse": round(rmse(all_errors[s]), 3),
                    "blended_baseline_mae": round(mae(baseline_errors[s]), 3),
                    "last_10_mean_mae": round(mae(last_ten_errors[s]), 3),
                    "range_coverage": round(sum(coverage[s]) / len(coverage[s]), 3),
                }
                for s in STATS
            },
        }
