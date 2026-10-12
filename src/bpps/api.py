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

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .auth import TokenVerifier, User
from .providers import create_provider
from .service import (
    HistoryRequest,
    PredictionRequest,
    PredictionService,
    ScenarioRequest,
    Season,
)
from .settings import Settings
from .supabase_store import ForecastStorageError, SupabaseForecastStore
from .tracking import ForecastStore


def create_app(settings: Settings | None = None, include_ui: bool = True):
    config = settings if settings is not None else Settings()
    provider = create_provider(settings=config)
    forecasts = ForecastStore(config.forecast_db, "stub" if config.stub_mode else "nba")
    service = PredictionService(
        provider,
        config.cache_dir / "models",
        config.model_backend,
        None if config.public_demo or config.auth_enabled else forecasts,
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
    application.state.token_verifier = (
        TokenVerifier(config.supabase_url) if config.auth_enabled else None
    )
    bearer = HTTPBearer(auto_error=False)

    def current_user(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> User | None:
        if not config.auth_enabled:
            return None
        if credentials is None:
            raise HTTPException(
                401,
                "Sign in to access live forecasts and your forecast history.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return application.state.token_verifier.verify(credentials.credentials)

    def user_store(user: User | None) -> ForecastStore:
        if config.auth_enabled:
            if user is None:
                raise HTTPException(401, "Please sign in again.")
            return SupabaseForecastStore(
                config.supabase_url,
                config.supabase_service_role_key.get_secret_value(),
                "stub" if config.stub_mode else "nba",
                user.id,
            )
        require_private_application()
        return forecasts

    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["Retry-After"],
    )
    capacity = BoundedSemaphore(1)
    budget_lock = Lock()
    prediction_times: deque[float] = deque()
    logger = logging.getLogger("uvicorn.error")

    @contextmanager
    def prediction_slot():
        if not config.public_demo and not config.auth_enabled:
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
    @application.exception_handler(ForecastStorageError)
    def storage_error(request: Request, exc: Exception):
        return JSONResponse(
            status_code=503,
            content={"detail": "Forecast history storage is unavailable; retry later."},
        )

    @application.get("/health")
    def health():
        return {
            "status": "ok",
            "stub_mode": service.stub,
            "auth_enabled": bool(config.auth_enabled),
            "backtests_enabled": not bool(config.public_demo),
        }

    @application.get("/ready")
    def readiness():
        try:
            config.cache_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryFile(dir=config.cache_dir):
                pass
        except OSError:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ready", "public_demo": bool(config.public_demo)}

    @application.get("/games", dependencies=[Depends(current_user)])
    def games(game_date: Annotated[date | None, Query(alias="date")] = None):
        return service.games(game_date or datetime.now(UTC).date())

    @application.get("/teams/{team_id}/players", dependencies=[Depends(current_user)])
    def players(team_id: str, season: Annotated[Season, Query()]):
        return service.players(team_id, season)

    @application.post("/predictions")
    def prediction(
        body: PredictionRequest, user: Annotated[User | None, Depends(current_user)]
    ):
        with prediction_slot():
            if config.auth_enabled:
                return service.prediction(body, user_store(user))
            return service.prediction(body)

    @application.post("/backtests", dependencies=[Depends(current_user)])
    def evaluate(body: HistoryRequest):
        require_private_application()
        with prediction_slot():
            return service.evaluate(body)

    @application.post("/predictions/scenarios", dependencies=[Depends(current_user)])
    def minute_scenarios(body: ScenarioRequest):
        with prediction_slot():
            return service.minute_scenarios(body)

    @application.get("/forecasts")
    def forecast_history(
        user: Annotated[User | None, Depends(current_user)],
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        return user_store(user).report(limit, offset)

    @application.post("/forecasts/refresh")
    def refresh_forecasts(user: Annotated[User | None, Depends(current_user)]):
        store = user_store(user)
        with prediction_slot():
            return store.refresh(provider)

    if include_ui:
        from .frontend import mount_frontend

        mount_frontend(application, config.frontend_dir)
    return application


app = create_app()
