"""Shared prediction workflow for the REST API and frontend."""

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .learning import create_backend
from .prediction_engine import PredictionEngine
from .providers import NBAClient, StubClient
from .settings import Settings
from .tracking import ForecastStore, require_pregame

Season = Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
SeasonType = Literal["Regular Season", "Playoffs", "Pre Season"]


class HistoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_id: str = Field(min_length=1, max_length=40)
    seasons: list[Season] | None = Field(default=None, min_length=1, max_length=5)
    season_type: SeasonType = "Regular Season"


class ScenarioRequest(HistoryRequest):
    game_id: str = Field(min_length=1, max_length=40)


class PredictionRequest(ScenarioRequest):
    minutes: float | None = Field(default=None, ge=0, le=48, allow_inf_nan=False)


def validate_season(season):
    if (int(season[:4]) + 1) % 100 != int(season[-2:]):
        raise HTTPException(422, "Season must contain consecutive years, e.g. 2025-26")
    return season


class PredictionService:
    def __init__(
        self,
        provider: NBAClient | StubClient,
        cache_dir: Path | None = None,
        backend_name: str = "ridge",
        forecast_store: ForecastStore | None = None,
    ):
        self.provider = provider
        self.stub = isinstance(provider, StubClient)
        self.cache_dir = (
            cache_dir if cache_dir is not None else Settings().cache_dir / "models"
        )
        self.backend = create_backend(backend_name)
        self.engines: dict[str, PredictionEngine] = {}
        self.forecast_store = forecast_store

    def engine(self, season_type: str) -> PredictionEngine:
        if season_type not in self.engines:
            self.engines[season_type] = PredictionEngine(
                self.cache_dir,
                source="stub" if self.stub else "nba",
                season_type=season_type,
                backend=self.backend,
            )
        return self.engines[season_type]

    def games(self, target: date):
        return {
            "stub_mode": self.stub,
            "games": [
                g
                for g in self.provider.schedule()
                if g["date"] == target.isoformat() and g["status"] == 1
            ],
        }

    def players(self, team_id: str, season: str):
        return {
            "stub_mode": self.stub,
            "players": self.provider.roster(team_id, validate_season(season)),
        }

    def history(self, body: HistoryRequest, through: date | None = None):
        if body.seasons is None:
            logs = self.provider.career_logs(
                body.player_id, through or datetime.now(UTC).date(), body.season_type
            )
        else:
            logs = []
            for season in dict.fromkeys(body.seasons):
                logs.extend(
                    self.provider.logs(
                        body.player_id, validate_season(season), body.season_type
                    )
                )
        if not logs:
            raise HTTPException(
                404, "No player history found for the requested seasons"
            )
        return logs

    def player_context(self, player_id: str, game_id: str):
        game = next(
            (g for g in self.provider.schedule() if str(g["game_id"]) == game_id),
            None,
        )
        if game is None:
            raise HTTPException(404, "Game not found")
        if game["status"] != 1:
            raise HTTPException(409, "Game has already started or finished")
        try:
            require_pregame(dict(game))
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        game_date = date.fromisoformat(game["date"])
        start = game_date.year if game_date.month >= 7 else game_date.year - 1
        season = f"{start}-{str(start + 1)[-2:]}"
        home = None
        player_name = player_id
        for team_id, is_home in (
            (game["home_team_id"], True),
            (game["away_team_id"], False),
        ):
            roster = self.provider.roster(team_id, season)
            player = next((p for p in roster if str(p["PLAYER_ID"]) == player_id), None)
            if player is not None:
                home = is_home
                player_name = player["PLAYER"]
                break
        if home is None:
            raise HTTPException(
                422, "Player is not on either participating team's roster"
            )
        return game, game_date, home, player_name

    def prediction(self, body: PredictionRequest):
        game, game_date, home, player_name = self.player_context(
            body.player_id, body.game_id
        )
        logs = self.history(body, game_date)
        try:
            result = self.engine(body.season_type).prediction(
                logs,
                body.player_id,
                game_date,
                game["away_team" if home else "home_team"],
                home,
                body.minutes,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        result.update(
            game_id=body.game_id,
            team=game["home_team" if home else "away_team"],
            roster_verified=True,
            stub_mode=self.stub,
            player_name=player_name,
            tipoff_utc=game.get("tipoff_utc"),
        )
        if self.stub:
            result["warnings"].append(
                "Synthetic stub data; this is not a real NBA prediction."
            )
        if self.forecast_store is not None:
            # Training may cross tipoff. Never archive a post-tipoff forecast.
            try:
                require_pregame(dict(game))
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
            result.update(self.forecast_store.save(body.model_dump(), result))
        return result

    def minute_scenarios(self, body: ScenarioRequest):
        game, game_date, home, _ = self.player_context(body.player_id, body.game_id)
        logs = self.history(body, game_date)
        try:
            return self.engine(body.season_type).minute_scenarios(
                logs,
                body.player_id,
                game_date,
                game["away_team" if home else "home_team"],
                home,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def evaluate(self, body: HistoryRequest):
        logs = self.history(body)
        try:
            result = self.engine(body.season_type).backtest(logs, body.player_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {**result, "stub_mode": self.stub}
