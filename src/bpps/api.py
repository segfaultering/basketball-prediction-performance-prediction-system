"""FastAPI HTTP interface with a Gradio frontend at /ui."""

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from .providers import create_provider
from .service import HistoryRequest, PredictionRequest, PredictionService, Season
from .settings import Settings


def create_app(settings: Settings | None = None, include_ui: bool = True):
    config = settings if settings is not None else Settings()
    provider = create_provider(settings=config)
    service = PredictionService(provider)
    application = FastAPI(
        title="Basketball Performance Prediction API",
        debug=config.debug == 1,
        version="0.1.0",
        description="Predictions are conditional on playing. STUB_MODE uses synthetic data.",
    )
    application.state.provider = provider
    application.state.settings = config
    application.state.service = service

    @application.exception_handler(ValueError)
    def upstream_error(request: Request, exc: ValueError):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

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

    if include_ui:
        import gradio as gr

        from .frontend import build_frontend

        @application.get("/", include_in_schema=False)
        def index():
            return RedirectResponse("/ui/")

        application = gr.mount_gradio_app(
            application, build_frontend(service), path="/ui"
        )
    return application


app = create_app()
