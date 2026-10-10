"""Immutable pregame forecasts and separately refreshed outcomes in SQLite."""

import json
import math
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from .baseline import season_name, season_start
from .model import STATS, GameLog
from .providers import NBAClient, StubClient


def require_pregame(game: dict, now: datetime | None = None) -> None:
    current = now if now is not None else datetime.now(UTC)
    if game["status"] != 1:
        raise ValueError("Game has already started or finished")
    tipoff = game.get("tipoff_utc")
    if tipoff:
        start = datetime.fromisoformat(tipoff)
        if start.tzinfo is None:
            start = start.replace(tzinfo=UTC)
        started = current >= start
    else:
        started = game["date"] < current.date().isoformat()
    if started:
        raise ValueError(
            "Game tipoff has passed; forecasts must be saved before tipoff"
        )


class ForecastStore:
    def __init__(self, path: Path, source: str):
        self.path = path
        self.source = source

    def _connect(self) -> sqlite3.Connection:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise sqlite3.OperationalError(
                "Cannot create forecast storage directory"
            ) from exc
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS forecasts (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                inputs TEXT NOT NULL,
                prediction TEXT NOT NULL,
                outcome TEXT,
                updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS forecasts_source_created
                ON forecasts(source, created_at);
        """)
        return connection

    def save(self, inputs: dict[str, Any], prediction: dict[str, Any]) -> dict:
        identifier = str(uuid4())
        created = datetime.now(UTC).isoformat()
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "INSERT INTO forecasts(id, source, created_at, inputs, prediction) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    identifier,
                    self.source,
                    created,
                    json.dumps(inputs, allow_nan=False),
                    json.dumps(prediction, allow_nan=False),
                ),
            )
        return {"forecast_id": identifier, "saved_at": created}

    def records(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT * FROM forecasts WHERE source = ? ORDER BY created_at, rowid",
                (self.source,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "inputs": json.loads(row["inputs"]),
                "prediction": json.loads(row["prediction"]),
                "outcome": json.loads(row["outcome"]) if row["outcome"] else None,
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    def settle(self, identifiers: list[str], game: GameLog) -> None:
        outcome = {
            "game_id": game.game_id,
            "date": game.date.isoformat(),
            "minutes": game.minutes,
            "stats": {stat: getattr(game, stat) for stat in STATS},
        }
        with closing(self._connect()) as connection, connection:
            connection.executemany(
                "UPDATE forecasts SET outcome = ?, updated_at = ? "
                "WHERE id = ? AND source = ?",
                [
                    (
                        json.dumps(outcome, allow_nan=False),
                        datetime.now(UTC).isoformat(),
                        identifier,
                        self.source,
                    )
                    for identifier in identifiers
                ],
            )

    def report(self, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        records = self.records()
        first: dict[tuple, dict] = {}
        for record in records:
            prediction = record["prediction"]
            key = (
                prediction["player_id"],
                prediction["game_id"],
                prediction["game_date"] if self.source == "stub" else None,
            )
            record["primary"] = key not in first
            first.setdefault(key, record)
            actual = record["outcome"]
            record["status"] = (
                "pending"
                if actual is None
                else "did_not_play"
                if actual["minutes"] == 0
                else "settled"
            )
            record["errors"] = (
                {
                    stat: round(
                        prediction["stats"][stat]["prediction"] - actual["stats"][stat],
                        3,
                    )
                    for stat in STATS
                }
                if record["status"] == "settled"
                else None
            )
        evaluated = [r for r in first.values() if r["status"] == "settled"]
        metrics = {}
        for stat in STATS:
            errors = [
                r["prediction"]["stats"][stat]["prediction"]
                - r["outcome"]["stats"][stat]
                for r in evaluated
            ]
            baseline_errors = [
                r["prediction"]["baseline"]["stats"][stat] - r["outcome"]["stats"][stat]
                for r in evaluated
            ]
            covered = sum(
                r["prediction"]["stats"][stat]["approximate_80pct_range"][0]
                <= r["outcome"]["stats"][stat]
                <= r["prediction"]["stats"][stat]["approximate_80pct_range"][1]
                for r in evaluated
            )
            count = len(errors)
            metrics[stat] = {
                "mae": round(sum(abs(e) for e in errors) / count, 3) if count else None,
                "rmse": round(math.sqrt(sum(e * e for e in errors) / count), 3)
                if count
                else None,
                "baseline_mae": round(sum(abs(e) for e in baseline_errors) / count, 3)
                if count
                else None,
                "range_coverage": round(covered / count, 3) if count else None,
            }
        return {
            "stub_mode": self.source == "stub",
            "total": len(records),
            "forecasts": list(reversed(records))[offset : offset + limit],
            "summary": {
                "tracked_games": len(first),
                "evaluated_games": len(evaluated),
                "pending_games": sum(r["status"] == "pending" for r in first.values()),
                "did_not_play_games": sum(
                    r["status"] == "did_not_play" for r in first.values()
                ),
                "stats": metrics,
            },
        }

    def refresh(self, provider: NBAClient | StubClient) -> dict:
        # A separate live client bypasses response caches without changing the
        # provider used by concurrent prediction requests.
        client = (
            NBAClient(provider.cache_dir, refresh=True)
            if isinstance(provider, NBAClient)
            else provider
        )
        groups: dict[tuple[str, str, str], list[dict]] = {}
        for record in self.records():
            prediction = record["prediction"]
            season = season_name(
                season_start(datetime.fromisoformat(prediction["game_date"]).date())
            )
            key = (season, prediction["player_id"], record["inputs"]["season_type"])
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
                        schedules[season] = (
                            client.schedule(season)
                            if isinstance(client, NBAClient)
                            else client.schedule()
                        )
                    except ValueError as exc:
                        failures[season] = str(exc)
                        raise
                final = {
                    (g["game_id"], g["date"] if self.source == "stub" else None)
                    for g in schedules[season]
                    if g["status"] == 3
                }
                eligible = [
                    r
                    for r in records
                    if (
                        r["prediction"]["game_id"],
                        r["prediction"]["game_date"] if self.source == "stub" else None,
                    )
                    in final
                ]
                if not eligible:
                    continue
                # History selection need not match the target game's type:
                # regular-season history can forecast a playoff appearance.
                types = [season_type]
                if self.source == "nba":
                    types.extend(
                        t
                        for t in ("Regular Season", "Playoffs", "Pre Season")
                        if t != season_type
                    )
                for outcome_type in types:
                    if not eligible:
                        break
                    logs = client.logs(player, season, outcome_type)
                    for game in logs:
                        identifiers = [
                            r["id"]
                            for r in eligible
                            if r["prediction"]["game_id"] == game.game_id
                            # NBA game-log dates use local calendar days while the
                            # schedule uses UTC; the NBA game ID is authoritative.
                            and (
                                self.source != "stub"
                                or r["prediction"]["game_date"] == game.date.isoformat()
                            )
                            and game.player_id == player
                        ]
                        if identifiers:
                            self.settle(identifiers, game)
                            updated += len(identifiers)
                            eligible = [
                                r for r in eligible if r["id"] not in identifiers
                            ]
            except (ValueError, OSError, KeyError, TypeError) as exc:
                errors.append(
                    {"player_id": player, "season": season, "detail": str(exc)}
                )
        return {
            "updated_forecasts": updated,
            "errors": errors,
            "stub_mode": self.source == "stub",
        }
