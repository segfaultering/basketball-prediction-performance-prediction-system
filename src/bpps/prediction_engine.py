"""Per-player prediction orchestration and model-cache reuse."""

import hashlib
import json
import math
from datetime import date
from pathlib import Path
from threading import Lock
from typing import Any

from .artifacts import ArtifactIdentity, ModelArtifact, validate_artifact
from .baseline import FEATURE_NAMES, history_digest, make_context, validate_logs
from .cache import write_json_atomic
from .forecasting import PreparedForecast, prepare_forecast
from .learning import CorrectionBackend, create_backend
from .metrics import mean_absolute_error as mae
from .metrics import root_mean_squared_error as rmse
from .model import STATS, GameLog
from .training import TrainingRow, train_models, training_rows

SCHEMA_VERSION = 1


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

    def _identity(self, history: list[GameLog]) -> ArtifactIdentity:
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

    def _train(
        self, rows: list[TrainingRow], identity: ArtifactIdentity
    ) -> ModelArtifact:
        return train_models(rows, identity, self.backend)

    def train(
        self, logs: list[GameLog], player_id: str, as_of: date, refresh: bool = False
    ) -> ModelArtifact:
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
                    artifact = validate_artifact(artifact, identity, self.backend)
                    artifact["cache_hit"] = True
                    return artifact
                except ValueError, TypeError, KeyError, OSError:
                    pass  # Invalid artifacts are rebuilt from history.
            artifact = self._train(training_rows(history), identity)
            artifact["cache_hit"] = False
            if path is not None:
                write_json_atomic(path, artifact)
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
        return self.prepare(logs, player_id, game_date, opponent, home).prediction(
            minutes
        )

    def prepare(
        self,
        logs: list[GameLog],
        player_id: str,
        game_date: date,
        opponent: str,
        home: bool,
    ) -> PreparedForecast:
        history = [
            game
            for game in validate_logs(logs, player_id)
            if game.minutes > 0 and game.date < game_date
        ]
        context = make_context(history, game_date, home)
        artifact = self.train(history, player_id, game_date)
        return prepare_forecast(
            history,
            player_id,
            game_date,
            opponent,
            home,
            context,
            artifact,
            self.backend,
        )

    def minute_scenarios(
        self,
        logs: list[GameLog],
        player_id: str,
        game_date: date,
        opponent: str,
        home: bool,
    ) -> dict[str, Any]:
        return self.prepare(
            logs, player_id, game_date, opponent, home
        ).minute_scenarios()

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
            prediction = prepare_forecast(
                prior,
                player_id,
                game.date,
                game.opponent,
                game.home,
                row.context,
                artifact,
                self.backend,
            ).prediction()
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
