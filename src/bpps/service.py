"""Shared prediction workflow for the REST API and frontend."""

from datetime import date
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .model import backtest, predict
from .providers import NBAClient, StubClient

Season = Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
SeasonType = Literal["Regular Season", "Playoffs", "Pre Season"]


class HistoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    player_id: str = Field(min_length=1, max_length=40)
    seasons: list[Season] = Field(min_length=1, max_length=5)
    season_type: SeasonType = "Regular Season"


class PredictionRequest(HistoryRequest):
    game_id: str = Field(min_length=1, max_length=40)
    minutes: float | None = Field(default=None, ge=0, le=48, allow_inf_nan=False)


def validate_season(season):
    if (int(season[:4]) + 1) % 100 != int(season[-2:]):
        raise HTTPException(422, "Season must contain consecutive years, e.g. 2025-26")
    return season


class PredictionService:
    def __init__(self, provider: NBAClient | StubClient):
        self.provider = provider
        self.stub = isinstance(provider, StubClient)

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

    def history(self, body):
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

    def prediction(self, body: PredictionRequest):
        game = next(
            (g for g in self.provider.schedule() if str(g["game_id"]) == body.game_id),
            None,
        )
        if game is None:
            raise HTTPException(404, "Game not found")
        if game["status"] != 1:
            raise HTTPException(409, "Game has already started or finished")
        game_date = date.fromisoformat(game["date"])
        start = game_date.year if game_date.month >= 7 else game_date.year - 1
        season = f"{start}-{str(start + 1)[-2:]}"
        home = None
        for team_id, is_home in (
            (game["home_team_id"], True),
            (game["away_team_id"], False),
        ):
            roster = self.provider.roster(team_id, season)
            if any(str(p["PLAYER_ID"]) == body.player_id for p in roster):
                home = is_home
                break
        if home is None:
            raise HTTPException(
                422, "Player is not on either participating team's roster"
            )
        logs = self.history(body)
        try:
            result = predict(
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
        )
        if self.stub:
            result["warnings"].append(
                "Synthetic stub data; this is not a real NBA prediction."
            )
        return result

    def evaluate(self, body: HistoryRequest):
        logs = self.history(body)
        try:
            result = backtest(logs, body.player_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {**result, "stub_mode": self.stub}
