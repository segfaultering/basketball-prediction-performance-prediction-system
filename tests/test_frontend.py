from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from bpps.frontend import FrontendController
from bpps.providers import StubClient
from bpps.service import PredictionService
from bpps.settings import Settings


@pytest.fixture
def controller(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Frontend attempted an NBA request in stub mode")

    monkeypatch.setattr("requests.sessions.Session.request", forbidden)
    return FrontendController(PredictionService(StubClient()))


def test_game_to_player_to_prediction(controller):
    choices, games, message = controller.load_games(
        datetime.now(UTC).date().isoformat()
    )
    assert choices[0][1] == "demo-game"
    assert "Found 1" in message
    players, message = controller.load_players("demo-game", games)
    assert {p[1] for p in players} == {"demo-player", "demo-celtics-player"}
    rows, details, message = controller.predict(
        "demo-game", "demo-player", "2025-26", True, 32
    )
    assert len(rows) == 5
    assert rows[-1][0] == "Blocks"
    assert details is not None
    assert details["stub_mode"] is True
    assert details["projected_minutes"] == 32
    assert "Synthetic stub data" in message


def test_bad_date_and_empty_selection(controller):
    assert controller.load_games("bad")[0:2] == ([], [])
    assert controller.load_players(None, [])[0] == []
    rows, details, message = controller.predict(None, None, "2025-26", False, 32)
    assert rows == [] and details is None
    assert "Select a game" in message


def test_bad_season_clears_result(controller):
    rows, details, message = controller.predict(
        "demo-game", "demo-player", "wrong", False, 32
    )
    assert rows == [] and details is None
    assert "Check your inputs" in message


def test_upstream_error_clears_options(controller, monkeypatch):
    def unavailable():
        raise ValueError("NBA data unavailable")

    monkeypatch.setattr(controller.service.provider, "schedule", unavailable)
    choices, games, message = controller.load_games(
        datetime.now(UTC).date().isoformat()
    )
    assert choices == [] and games == []
    assert message == "NBA data unavailable"


def test_mounted_frontend(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "1")
    from bpps.api import create_app

    app = create_app(Settings(_env_file=None, stub_mode=1, debug=0))
    with TestClient(app) as client:
        response = client.get("/ui/")
        assert response.status_code == 200
        assert "NBA Player Predictions" in response.text
        assert client.get("/", follow_redirects=False).headers["location"] == "/ui/"
        config = client.get("/ui/config").json()
        assert config["analytics_enabled"] is False
        assert client.get("/health").json()["stub_mode"] is True
