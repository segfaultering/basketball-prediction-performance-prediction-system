"""Immutable pregame forecasts and separately refreshed outcomes in SQLite."""

import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from .forecast_reporting import ForecastSummary, decorate_record
from .model import STATS, GameLog
from .providers import DataProvider


def decode_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "inputs": json.loads(row["inputs"]),
        "prediction": json.loads(row["prediction"]),
        "outcome": json.loads(row["outcome"]) if row["outcome"] else None,
        "updated_at": row["updated_at"],
    }


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

    def _records(self, connection: sqlite3.Connection):
        rows = connection.execute(
            "SELECT * FROM forecasts WHERE source = ? ORDER BY created_at, rowid",
            (self.source,),
        )
        return (decode_record(row) for row in rows)

    def records(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            return list(self._records(connection))

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
        summary = ForecastSummary(self.source)
        with closing(self._connect()) as connection:
            # Summary and page must describe the same archive snapshot.
            connection.execute("BEGIN")
            for record in self._records(connection):
                summary.add(record)
            rows = connection.execute(
                "SELECT * FROM forecasts WHERE source = ? "
                "ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                (self.source, limit, offset),
            )
            page = [
                decorate_record(decode_record(row), row["id"] in summary.primary_ids)
                for row in rows
            ]
        return {
            "stub_mode": self.source == "stub",
            "total": summary.total,
            "forecasts": page,
            "summary": summary.report(),
        }

    def refresh(self, provider: DataProvider) -> dict:
        from .outcomes import refresh_outcomes

        return refresh_outcomes(self, provider)
