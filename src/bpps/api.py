"""FastAPI HTTP interface. Start with uvicorn bpps.api:app."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .model import backtest, predict
from .providers import StubClient, create_provider
from .settings import Settings

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


def create_app(settings: Settings | None = None):
    config = settings if settings is not None else Settings()
    provider = create_provider(settings=config)
    stub = isinstance(provider, StubClient)
    application = FastAPI(
        title="Basketball Performance Prediction API",
        debug=config.debug == 1,
        version="0.1.0",
        description="Predictions are conditional on playing. STUB_MODE uses synthetic data.",
    )
    application.state.provider = provider
    application.state.settings = config

    @application.exception_handler(ValueError)
    def upstream_error(request: Request, exc: ValueError):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    def history(body):
        logs = []
        for season in dict.fromkeys(body.seasons):
            logs.extend(
                application.state.provider.logs(
                    body.player_id, validate_season(season), body.season_type
                )
            )
        if not logs:
            raise HTTPException(
                404, "No player history found for the requested seasons"
            )
        return logs

    @application.get("/health")
    def health():
        return {"status": "ok", "stub_mode": stub}

    @application.get("/games")
    def games(game_date: Annotated[date | None, Query(alias="date")] = None):
        target = game_date or datetime.now(UTC).date()
        return {
            "stub_mode": stub,
            "games": [
                g
                for g in application.state.provider.schedule()
                if g["date"] == target.isoformat() and g["status"] == 1
            ],
        }

    @application.get("/teams/{team_id}/players")
    def players(team_id: str, season: Annotated[Season, Query()]):
        return {
            "stub_mode": stub,
            "players": application.state.provider.roster(
                team_id, validate_season(season)
            ),
        }

    @application.post("/predictions")
    def prediction(body: PredictionRequest):
        game = next(
            (
                g
                for g in application.state.provider.schedule()
                if str(g["game_id"]) == body.game_id
            ),
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
        for side in ("home", "away"):
            roster = application.state.provider.roster(game[f"{side}_team_id"], season)
            if any(str(p["PLAYER_ID"]) == body.player_id for p in roster):
                home = side == "home"
                break
        if home is None:
            raise HTTPException(
                422, "Player is not on either participating team's roster"
            )
        logs = history(body)
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
            stub_mode=stub,
        )
        if stub:
            result["warnings"].append(
                "Synthetic stub data; this is not a real NBA prediction."
            )
        return result

    @application.post("/backtests")
    def evaluate(body: HistoryRequest):
        logs = history(body)
        try:
            result = backtest(logs, body.player_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {**result, "stub_mode": stub}

    return application


app = create_app()
