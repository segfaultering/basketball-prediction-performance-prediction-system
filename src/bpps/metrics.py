"""Unrounded error metrics; callers control presentation and empty samples."""

import math
from collections.abc import Sequence


def mean_absolute_error(values: Sequence[float]) -> float:
    return sum(abs(value) for value in values) / len(values)


def mean_squared_error(values: Sequence[float]) -> float:
    return sum(value * value for value in values) / len(values)


def root_mean_squared_error(values: Sequence[float]) -> float:
    return math.sqrt(mean_squared_error(values))
