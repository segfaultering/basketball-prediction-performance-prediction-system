"""FastAPI HTTP interface with a React frontend at /ui/."""

import sqlite3
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .providers import create_provider
from .research import (
    PlayerContext,
    PlayerResearch,
    ResearchReport,
    ResearchRequest,
    ResearchUnavailable,
)
from .service import HistoryRequest, PredictionRequest, PredictionService, Season
from .settings import Settings
from .tracking import ForecastStore


def create_app(settings: Settings | None = None, include_ui: bool = True):
    config = settings if settings is not None else Settings()
    provider = create_provider(settings=config)
    forecasts = ForecastStore(config.forecast_db, "stub" if config.stub_mode else "nba")
    service = PredictionService(
        provider, config.cache_dir / "models", config.model_backend, forecasts
    )
    application = FastAPI(
        title="Basketball Performance Prediction API",
        debug=config.debug == 1,
        version="0.1.0",
        description="Predictions are conditional on playing. STUB_MODE uses synthetic data.",
    )
    application.state.provider = provider
    application.state.settings = config
    application.state.service = service
    application.state.forecasts = forecasts
    application.state.research = PlayerResearch(config)

    @application.exception_handler(ValueError)
    def upstream_error(request: Request, exc: ValueError):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @application.exception_handler(sqlite3.Error)
    def storage_error(request: Request, exc: sqlite3.Error):
        return JSONResponse(
            status_code=503,
            content={"detail": "Forecast history storage is unavailable; retry later."},
        )

    @application.exception_handler(ResearchUnavailable)
    def research_unavailable(request: Request, exc: ResearchUnavailable):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @application.post("/player-research", response_model=ResearchReport)
    async def player_research(body: ResearchRequest):
        game, game_date, home, name = await run_in_threadpool(
            service.player_context, body.player_id, body.game_id
        )
        context = PlayerContext(
            player_id=body.player_id,
            player_name=name,
            game_id=body.game_id,
            game_date=game_date,
            team=game["home_team" if home else "away_team"],
            opponent=game["away_team" if home else "home_team"],
        )
        return await application.state.research.research(context)

    @application.get("/health")
    def health():
        return {"status": "ok", "stub_mode": service.stub}

    @application.get("/games")
    def games(game_date: Annotated[date | None, Query(alias="date")] = None):
        return service.games(game_date or datetime.now(UTC).date())

    @application.get("/teams/{team_id}/players")
    def players(team_id: str, season: Annotated[Season, Query()]):
        return service.players(team_id, season)

    @application.post("/predictions")
    def prediction(body: PredictionRequest):
        return service.prediction(body)

    @application.post("/backtests")
    def evaluate(body: HistoryRequest):
        return service.evaluate(body)

    @application.get("/forecasts")
    def forecast_history(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        return forecasts.report(limit, offset)

    @application.post("/forecasts/refresh")
    def refresh_forecasts():
        return forecasts.refresh(provider)

    if include_ui:
        from .frontend import mount_frontend

        mount_frontend(application)
    return application


app = create_app()
