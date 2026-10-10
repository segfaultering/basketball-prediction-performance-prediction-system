"""Replaceable correction backends; persisted models contain JSON, not pickles."""

import math
from dataclasses import dataclass
from typing import Any, Protocol


class CorrectionModel(Protocol):
    def predict(self, features: list[float]) -> float: ...

    def payload(self) -> dict[str, Any]: ...


class CorrectionBackend(Protocol):
    @property
    def identity(self) -> str: ...

    @property
    def parameters(self) -> tuple[float, ...]: ...

    def fit(
        self,
        features: list[list[float]],
        targets: list[float],
        minutes: list[float],
        parameter: float,
    ) -> CorrectionModel: ...

    def restore(
        self, payload: dict[str, Any], feature_count: int
    ) -> CorrectionModel: ...


@dataclass(frozen=True)
class LinearCorrection:
    coefficients: list[float]
    intercept: float

    def predict(self, features: list[float]) -> float:
        return self.intercept + sum(
            c * x for c, x in zip(self.coefficients, features, strict=True)
        )

    def payload(self) -> dict[str, Any]:
        return {"coefficients": self.coefficients, "intercept": self.intercept}


class RidgeBackend:
    identity = "ridge-v1"
    parameters = (1.0, 10.0, 100.0)

    def fit(self, features, targets, minutes, parameter) -> LinearCorrection:
        # Fit scaling only on this training partition, never tuning/validation rows.
        from sklearn.linear_model import Ridge
        from sklearn.preprocessing import StandardScaler

        scaler = StandardScaler()
        scaled = scaler.fit_transform(features)
        average_minutes = sum(minutes) / len(minutes)
        weights = [m / average_minutes for m in minutes]
        estimator = Ridge(alpha=parameter)
        estimator.fit(scaled, targets, sample_weight=weights)
        scale = scaler.scale_
        means = scaler.mean_
        if scale is None or means is None:
            raise ValueError("Training did not produce feature scaling parameters")
        # Convert back to original feature units for portable JSON inference.
        coefficients = [
            float(c / scale) for c, scale in zip(estimator.coef_, scale, strict=True)
        ]
        intercept = float(estimator.intercept_) - sum(
            c * float(mean) for c, mean in zip(coefficients, means, strict=True)
        )
        model = LinearCorrection(coefficients, intercept)
        return self.restore(model.payload(), len(features[0]))

    def restore(self, payload, feature_count) -> LinearCorrection:
        coefficients = [float(c) for c in payload["coefficients"]]
        intercept = float(payload["intercept"])
        if len(coefficients) != feature_count or not all(
            math.isfinite(v) for v in (*coefficients, intercept)
        ):
            raise ValueError("Invalid linear model artifact")
        return LinearCorrection(coefficients, intercept)


def create_backend(name: str) -> CorrectionBackend:
    """Add future backend factories here; orchestration uses only the protocol."""
    factories = {"ridge": RidgeBackend}
    if name not in factories:
        raise ValueError(f"Unknown model backend: {name}")
    return factories[name]()
