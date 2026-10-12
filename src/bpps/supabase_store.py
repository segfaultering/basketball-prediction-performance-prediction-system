"""Durable user-scoped forecasts via Supabase's PostgREST API."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from .model import STATS, GameLog
from .tracking import ForecastStore


class ForecastStorageError(Exception):
    pass


class SupabaseForecastStore(ForecastStore):
    def __init__(self, url: str, key: str, source: str, user_id: str):
        super().__init__(Path("."), source)
        self.url = f"{url}/rest/v1/forecasts"
        self.user_id = user_id
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def _request(
        self,
        method: str,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        # Service-role access bypasses RLS. Every read/update is scoped here;
        # inserts receive their owner solely from the verified JWT subject.
        scope = {"owner_id": f"eq.{self.user_id}", "source": f"eq.{self.source}"}
        try:
            with httpx.Client(timeout=15) as client:
                response = client.request(
                    method,
                    self.url,
                    headers=self.headers,
                    params={**(params or {}), **scope} if method != "POST" else None,
                    json=body,
                )
            response.raise_for_status()
            return response.json() if response.content else None
        except (httpx.HTTPError, ValueError) as exc:
            raise ForecastStorageError("Forecast storage is unavailable") from exc

    def save(self, inputs: dict[str, Any], prediction: dict[str, Any]) -> dict:
        identifier = str(uuid4())
        created = datetime.now(UTC).isoformat()
        self._request(
            "POST",
            body={
                "id": identifier,
                "owner_id": self.user_id,
                "source": self.source,
                "created_at": created,
                "inputs": inputs,
                "prediction": prediction,
            },
        )
        return {"forecast_id": identifier, "saved_at": created}

    def records(self) -> list[dict[str, Any]]:
        # Fetch all pages so accuracy summaries don't silently stop at Supabase's
        # response row limit. Keep pages sequential and bounded to 100 records.
        records: list[dict[str, Any]] = []
        while True:
            page = self._request(
                "GET",
                {
                    "select": "id,created_at,inputs,prediction,outcome,updated_at",
                    "order": "created_at.asc,id.asc",
                    "limit": "100",
                    "offset": str(len(records)),
                },
            )
            if not isinstance(page, list):
                raise ForecastStorageError("Invalid forecast storage response")
            records.extend(page)
            if len(page) < 100:
                return records

    def settle(self, identifiers: list[str], game: GameLog) -> None:
        if not identifiers:
            return
        self._request(
            "PATCH",
            {"id": f"in.({','.join(identifiers)})"},
            {
                "outcome": {
                    "game_id": game.game_id,
                    "date": game.date.isoformat(),
                    "minutes": game.minutes,
                    "stats": {stat: getattr(game, stat) for stat in STATS},
                },
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
