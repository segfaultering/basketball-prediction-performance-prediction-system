"""Public portfolio deployments avoid shared archives and bound expensive work."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from bpps.api import create_app
from bpps.settings import Settings


@pytest.fixture
def public_app(tmp_path):
    return create_app(
        Settings(
            _env_file=None,
            proj_dir=tmp_path,
            public_demo=1,
            debug=0,
            stub_mode=0,
            cors_origins=["https://courtside.example"],
        ),
        include_ui=False,
    )


def test_public_history_and_live_backtests_are_not_exposed(public_app):
    with TestClient(public_app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").json()["status"] == "ready"
        assert client.get("/forecasts").status_code == 403
        assert client.post("/forecasts/refresh").status_code == 403
        assert (
            client.post("/backtests", json={"player_id": "201939"}).status_code == 403
        )
    assert public_app.state.service.forecast_store is None
    assert not public_app.state.settings.forecast_db.exists()


def test_public_prediction_budget_and_explicit_cors(public_app, monkeypatch):
    monkeypatch.setattr(
        public_app.state.service, "prediction", lambda body: {"ok": True}
    )
    with TestClient(public_app) as client:
        allowed = client.options(
            "/predictions",
            headers={
                "Origin": "https://courtside.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert (
            allowed.headers["access-control-allow-origin"]
            == "https://courtside.example"
        )
        denied = client.options(
            "/predictions",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in denied.headers
        body = {"player_id": "201939", "game_id": "game"}
        for _ in range(10):
            assert client.post("/predictions", json=body).status_code == 200
        limited = client.post("/predictions", json=body)
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"
        # Exploration shares the same budget as saved predictions.
        assert client.post("/predictions/scenarios", json=body).status_code == 429


def test_busy_prediction_rejects_without_queueing(public_app, monkeypatch):
    entered, finish = Event(), Event()

    def slow_prediction(body):
        entered.set()
        assert finish.wait(5)
        return {"ok": True}

    monkeypatch.setattr(public_app.state.service, "prediction", slow_prediction)
    with (
        TestClient(public_app) as client,
        ThreadPoolExecutor(max_workers=1) as executor,
    ):
        body = {"player_id": "201939", "game_id": "game"}
        pending = executor.submit(client.post, "/predictions", json=body)
        try:
            assert entered.wait(5)
            assert client.post("/predictions", json=body).status_code == 503
            assert client.post("/predictions/scenarios", json=body).status_code == 503
        finally:
            finish.set()
        assert pending.result().status_code == 200
        assert client.post("/predictions", json=body).status_code == 200


def test_public_upstream_errors_hide_internal_details(public_app, monkeypatch):
    def unavailable(target):
        raise ValueError("private-key and internal file path")

    monkeypatch.setattr(public_app.state.service, "games", unavailable)
    with TestClient(public_app) as client:
        response = client.get("/games")
    assert response.status_code == 502
    assert "private-key" not in response.text
    assert "NBA replay" in response.text


@pytest.mark.parametrize("switch", ["debug", "stub_mode"])
def test_public_configuration_rejects_debug_and_synthetic_modes(switch):
    with pytest.raises(ValidationError, match="PUBLIC_DEMO requires"):
        Settings(
            _env_file=None,
            public_demo=1,
            debug=int(switch == "debug"),
            stub_mode=int(switch == "stub_mode"),
        )


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://",
        "https://example.com/path",
        "https://user:password@example.com",
        "https://example.com/",
        "http://example.com",
    ],
)
def test_cors_requires_a_browser_origin(origin):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=[origin])
