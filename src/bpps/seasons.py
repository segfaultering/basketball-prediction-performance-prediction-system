"""NBA season labels shared by the API, CLI, providers, and research tools."""

import re
from datetime import date


def season_start(day: date) -> int:
    """July-to-June labels, consistent with the application."""
    return day.year if day.month >= 7 else day.year - 1


def season_name(start: int) -> str:
    return f"{start}-{(start + 1) % 100:02d}"


def validate_season(season: str) -> str:
    if (
        re.fullmatch(r"[0-9]{4}-[0-9]{2}", season) is None
        or not 1 <= int(season[:4]) <= 9998
        or (int(season[:4]) + 1) % 100 != int(season[-2:])
    ):
        raise ValueError("Season must contain consecutive years, e.g. 2025-26")
    return season
