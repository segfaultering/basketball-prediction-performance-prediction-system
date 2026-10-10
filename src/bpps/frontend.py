"""Serve the compiled React interface alongside the prediction API."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .settings import PROJECT_ROOT


def mount_frontend(application: FastAPI, directory: Path | None = None) -> None:
    assets = directory if directory is not None else PROJECT_ROOT / "frontend" / "dist"

    @application.get("/", include_in_schema=False)
    def index():
        return RedirectResponse("/ui/")

    if (assets / "index.html").is_file():
        application.mount("/ui", StaticFiles(directory=assets, html=True), name="ui")
    else:

        @application.get("/ui", include_in_schema=False)
        @application.get("/ui/", include_in_schema=False)
        def missing_build():
            return HTMLResponse(
                "<!doctype html><html lang='en'><title>Courtside · Build required</title>"
                "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                "<body style='font-family:system-ui;padding:3rem;background:#f6f5f0'>"
                "<h1>The React interface needs a build.</h1>"
                "<p>From the project directory, run:</p>"
                "<pre>cd frontend\nnpm ci\nnpm run build</pre>"
                "<p>Then restart the API server. <a href='/docs'>API documentation</a>"
                " remains available.</p></body></html>",
                status_code=503,
            )
