"""FastAPI HTTP interface with a React frontend at /ui/."""

import logging
import sqlite3
import tempfile
import time
from collections import deque
from contextlib import contextmanager
from datetime import UTC, date, datetime
from threading import BoundedSemaphore, Lock
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .providers import create_provider
from .service import (
    HistoryRequest,
    PredictionRequest,
    PredictionService,
    ScenarioRequest,
    Season,
)
from .settings import Settings
from .tracking import ForecastStore


def create_app(settings: Settings | None = None, include_ui: bool = True):
    config = settings if settings is not None else Settings()
    provider = create_provider(settings=config)
    forecasts = ForecastStore(config.forecast_db, "stub" if config.stub_mode else "nba")
    service = PredictionService(
        provider,
        config.cache_dir / "models",
        config.model_backend,
        None if config.public_demo else forecasts,
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
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    capacity = BoundedSemaphore(1)
    budget_lock = Lock()
    prediction_times: deque[float] = deque()
    logger = logging.getLogger("uvicorn.error")

    @contextmanager
    def prediction_slot():
        if not config.public_demo:
            yield
            return
        with budget_lock:
            now = time.monotonic()
            while prediction_times and prediction_times[0] <= now - 60:
                prediction_times.popleft()
            if len(prediction_times) >= 10:
                raise HTTPException(
                    429,
                    "Live demo limit reached. Try again in a minute or use NBA replay.",
                    headers={"Retry-After": "60"},
                )
            if not capacity.acquire(blocking=False):
                raise HTTPException(
                    503,
                    "The live demo is preparing another forecast. Retry shortly or use NBA replay.",
                    headers={"Retry-After": "5"},
                )
            prediction_times.append(now)
        try:
            yield
        finally:
            capacity.release()

    def require_private_application():
        if config.public_demo:
            raise HTTPException(
                403,
                "This operation is disabled in the public demo. Use NBA replay for prepared evaluations; history is stored in your browser.",
            )

    @application.exception_handler(ValueError)
    def upstream_error(request: Request, exc: ValueError):
        logger.warning("Upstream data failure on %s", request.url.path)
        return JSONResponse(
            status_code=502,
            content={
                "detail": "NBA data is unavailable. Retry later or switch to NBA replay."
                if config.public_demo
                else str(exc)
            },
        )

    @application.exception_handler(sqlite3.Error)
    def storage_error(request: Request, exc: sqlite3.Error):
        return JSONResponse(
            status_code=503,
            content={"detail": "Forecast history storage is unavailable; retry later."},
        )

    @application.get("/health")
    def health():
        return {"status": "ok", "stub_mode": service.stub}

    @application.get("/ready")
    def readiness():
        try:
            config.cache_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryFile(dir=config.cache_dir):
                pass
        except OSError:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ready", "public_demo": bool(config.public_demo)}

    @application.get("/games")
    def games(game_date: Annotated[date | None, Query(alias="date")] = None):
        return service.games(game_date or datetime.now(UTC).date())

    @application.get("/teams/{team_id}/players")
    def players(team_id: str, season: Annotated[Season, Query()]):
        return service.players(team_id, season)

    @application.post("/predictions")
    def prediction(body: PredictionRequest):
        with prediction_slot():
            return service.prediction(body)

    @application.post("/backtests")
    def evaluate(body: HistoryRequest):
        require_private_application()
        return service.evaluate(body)

    @application.post("/predictions/scenarios")
    def minute_scenarios(body: ScenarioRequest):
        with prediction_slot():
            return service.minute_scenarios(body)

    @application.get("/forecasts")
    def forecast_history(
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        require_private_application()
        return forecasts.report(limit, offset)

    @application.post("/forecasts/refresh")
    def refresh_forecasts():
        require_private_application()
        return forecasts.refresh(provider)

    if include_ui:
        from .frontend import mount_frontend

        mount_frontend(application)
    return application


app = create_app()
