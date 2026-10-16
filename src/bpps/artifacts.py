"""Typed JSON artifacts and validation at the model-cache boundary."""

import math
from typing import Any, Literal, NotRequired, TypedDict

from pydantic import TypeAdapter

from .baseline import FEATURE_NAMES, TARGET_STATS, Candidate, Window
from .learning import CorrectionBackend


class BlendParameters(TypedDict):
    window: Window
    kind: Literal["fixed", "adaptive"]
    value: float


class StatArtifact(TypedDict):
    baseline: BlendParameters
    active: bool
    model: dict[str, Any] | None
    residual_variance: float
    parameter: NotRequired[float]
    baseline_mae: NotRequired[float]
    model_mae: NotRequired[float]
    baseline_rmse: NotRequired[float]
    model_rmse: NotRequired[float]


class ArtifactIdentity(TypedDict):
    schema_version: int
    backend: str
    backend_parameters: list[float]
    features: list[str]
    source: str
    season_type: str
    player_id: str
    history_sha256: str
    trained_through: str


class Evaluation(TypedDict):
    training_games: int
    tuning_games: int
    validation_games: int
    training_through: str
    tuning_through: str
    validation_start: str
    validation_through: str
    method: str


class ModelArtifact(ArtifactIdentity):
    training_games: int
    stats: dict[str, StatArtifact]
    status: Literal["trained", "insufficient_history"]
    evaluation: NotRequired[Evaluation]
    cache_hit: NotRequired[bool]


_adapter = TypeAdapter(ModelArtifact)


def validate_artifact(
    payload: object, identity: ArtifactIdentity, backend: CorrectionBackend
) -> ModelArtifact:
    artifact = _adapter.validate_python(payload, strict=True)
    if any(artifact.get(key) != value for key, value in identity.items()):
        raise ValueError("Incompatible model artifact")
    if set(artifact["stats"]) != set(TARGET_STATS):
        raise ValueError("Incomplete model artifact")
    if artifact["status"] == "trained" and "evaluation" not in artifact:
        raise ValueError("Missing chronological evaluation")
    for entry in artifact["stats"].values():
        Candidate(**entry["baseline"])
        if (
            not math.isfinite(entry["residual_variance"])
            or entry["residual_variance"] < 0
        ):
            raise ValueError("Invalid residual variance")
        if entry["model"] is None:
            if entry["active"]:
                raise ValueError("Active model has no fitted parameters")
            continue
        if entry["parameter"] not in backend.parameters:
            raise ValueError("Incompatible training parameters")
        backend.restore(entry["model"], len(FEATURE_NAMES))
        for name in ("baseline_mae", "model_mae", "baseline_rmse", "model_rmse"):
            value = entry[name]
            if not math.isfinite(value) or value < 0:
                raise ValueError("Invalid validation metrics")
    return artifact


def model_summary(artifact: ModelArtifact) -> dict[str, Any]:
    summary = {
        key: value
        for key, value in artifact.items()
        if key not in ("stats", "features", "backend_parameters")
    }
    summary["stats"] = {
        stat: {
            key: value
            for key, value in entry.items()
            if key not in ("model", "residual_variance")
        }
        for stat, entry in artifact["stats"].items()
    }
    return summary
