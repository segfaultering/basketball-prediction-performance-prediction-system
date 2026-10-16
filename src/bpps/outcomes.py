"""Refresh archived outcomes while preserving immutable forecast snapshots."""

from datetime import date
from typing import TYPE_CHECKING

from .model import GameLog
from .providers import DataProvider, NBAClient
from .seasons import season_name, season_start

if TYPE_CHECKING:
    from .tracking import ForecastStore


def game_key(game_id: str, game_date: str, source: str) -> tuple[str, str | None]:
    # NBA log dates and UTC schedule dates can differ; its game ID is authoritative.
    return game_id, game_date if source == "stub" else None


def matching_ids(records: list[dict], game: GameLog, source: str) -> list[str]:
    key = game_key(game.game_id, game.date.isoformat(), source)
    return [
        record["id"]
        for record in records
        if record["prediction"]["player_id"] == game.player_id
        and game_key(
            record["prediction"]["game_id"], record["prediction"]["game_date"], source
        )
        == key
    ]


def matched_outcomes(
    store: ForecastStore,
    client: DataProvider,
    records: list[dict],
    schedule: list,
    season: str,
    player: str,
    season_type: str,
):
    final = {
        game_key(game["game_id"], game["date"], store.source)
        for game in schedule
        if game["status"] == 3
    }
    eligible = [
        record
        for record in records
        if game_key(
            record["prediction"]["game_id"],
            record["prediction"]["game_date"],
            store.source,
        )
        in final
    ]
    types = [season_type]
    if store.source == "nba":
        types.extend(
            kind
            for kind in ("Regular Season", "Playoffs", "Pre Season")
            if kind != season_type
        )
    for outcome_type in types:
        if not eligible:
            break
        for game in client.logs(player, season, outcome_type):
            identifiers = matching_ids(eligible, game, store.source)
            if identifiers:
                yield identifiers, game
                eligible = [r for r in eligible if r["id"] not in identifiers]


def refresh_outcomes(store: ForecastStore, provider: DataProvider) -> dict:
    # Bypass response caches without changing concurrent prediction requests.
    client = (
        NBAClient(provider.cache_dir, refresh=True)
        if isinstance(provider, NBAClient)
        else provider
    )
    groups: dict[tuple[str, str, str], list[dict]] = {}
    for record in store.records():
        prediction = record["prediction"]
        season = season_name(season_start(date.fromisoformat(prediction["game_date"])))
        key = season, prediction["player_id"], record["inputs"]["season_type"]
        groups.setdefault(key, []).append(record)
    schedules: dict[str, list] = {}
    failures: dict[str, str] = {}
    errors = []
    updated = 0
    for (season, player, season_type), records in groups.items():
        try:
            if season in failures:
                raise ValueError(failures[season])
            if season not in schedules:
                try:
                    schedules[season] = client.schedule(season)
                except ValueError as exc:
                    failures[season] = str(exc)
                    raise
            for identifiers, game in matched_outcomes(
                store, client, records, schedules[season], season, player, season_type
            ):
                store.settle(identifiers, game)
                updated += len(identifiers)
        except (ValueError, OSError, KeyError, TypeError) as exc:
            errors.append({"player_id": player, "season": season, "detail": str(exc)})
    return {
        "updated_forecasts": updated,
        "errors": errors,
        "stub_mode": store.source == "stub",
    }
