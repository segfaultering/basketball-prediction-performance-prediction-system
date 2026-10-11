from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from bpps.providers import NBAClient, StubClient, create_provider
from bpps.settings import Settings


@pytest.fixture(autouse=True)
def isolate_settings(monkeypatch, tmp_path):
    # Developer .env must not influence unit tests.
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for key in ("STUB_MODE", "DEBUG", "PROJ_DIR"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("PROJ_DIR", str(tmp_path))


def current_season():
    today = datetime.now(UTC).date()
    start = today.year if today.month >= 7 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "1")

    def forbidden(*args, **kwargs):
        pytest.fail("Stub mode attempted an external NBA request")

    monkeypatch.setattr("requests.sessions.Session.request", forbidden)
    monkeypatch.setattr(NBAClient, "request", forbidden)
    from bpps.api import create_app

    with TestClient(create_app(include_ui=False)) as test_client:
        yield test_client


def payload(**kwargs):
    return {
        "player_id": "demo-player",
        "seasons": [current_season()],
        "game_id": "demo-game",
        **kwargs,
    }


def test_stub_full_flow_no_network(client):
    assert client.get("/health").json() == {"status": "ok", "stub_mode": True}
    games = client.get("/games").json()
    assert games["stub_mode"] is True
    assert games["games"][0]["game_id"] == "demo-game"
    players = client.get(
        "/teams/1610612747/players", params={"season": current_season()}
    )
    assert players.json()["players"][0]["PLAYER_ID"] == "demo-player"
    prediction = client.post("/predictions", json=payload())
    assert prediction.status_code == 200
    assert prediction.json()["stub_mode"] is True
    assert prediction.json()["roster_verified"] is True
    assert set(prediction.json()["stats"]) == {
        "points",
        "rebounds",
        "assists",
        "steals",
        "blocks",
    }
    result = client.post(
        "/backtests", json={"player_id": "demo-player", "seasons": [current_season()]}
    )
    assert result.status_code == 200
    assert result.json()["evaluated_games"] == 19
    assert client.get("/openapi.json").status_code == 200


def test_away_player_and_minutes(client):
    result = client.post(
        "/predictions", json=payload(player_id="demo-celtics-player", minutes=15)
    )
    assert result.status_code == 200
    assert result.json()["home"] is False
    assert result.json()["team"] == "BOS"
    assert result.json()["projected_minutes"] == 15


def test_minute_scenarios_match_forecasts_without_archiving(client):
    response = client.post("/predictions/scenarios", json=payload())
    assert response.status_code == 200
    result = response.json()
    assert [s["projected_minutes"] for s in result["scenarios"]] == list(range(49))
    assert client.get("/forecasts").json()["total"] == 0
    for minutes in (0, 24, 48):
        prediction = client.post("/predictions", json=payload(minutes=minutes)).json()
        assert result["scenarios"][minutes]["stats"] == prediction["stats"]
    default = client.post("/predictions", json=payload()).json()
    assert result["reference"]["projected_minutes"] == default["projected_minutes"]
    assert result["reference"]["stats"] == default["stats"]
    assert (
        client.post("/predictions/scenarios", json=payload(minutes=24)).status_code
        == 422
    )
    assert (
        client.post(
            "/predictions/scenarios", json=payload(player_id="not-in-roster")
        ).status_code
        == 422
    )


def test_automatic_career_training_and_baseline_response(client):
    request = {"player_id": "demo-player", "game_id": "demo-game"}
    response = client.post("/predictions", json=request)
    assert response.status_code == 200
    result = response.json()
    assert result["model"]["status"] == "trained"
    assert result["model"]["source"] == "stub"
    assert result["history_games"] > 24
    assert (
        result["baseline"]["stats"]["points"]
        == result["stats"]["points"]["baseline_prediction"]
    )
    repeated = client.post("/predictions", json=request).json()
    assert repeated["model"]["cache_hit"] is True
    assert repeated["stats"] == result["stats"]


@pytest.mark.parametrize(
    "changes",
    [
        {"minutes": -1},
        {"minutes": 49},
        {"seasons": []},
        {"seasons": ["2025-25"]},
        {"seasons": ["wrong"]},
        {"player_id": ""},
        {"unexpected": True},
    ],
)
def test_validation(client, changes):
    assert client.post("/predictions", json=payload(**changes)).status_code == 422


def test_missing_game_and_player(client):
    assert (
        client.post("/predictions", json=payload(game_id="missing")).status_code == 404
    )
    assert (
        client.post("/predictions", json=payload(player_id="missing")).status_code
        == 422
    )
    assert (
        client.post(
            "/backtests", json={"player_id": "missing", "seasons": [current_season()]}
        ).status_code
        == 404
    )
    assert client.get("/games?date=wrong").status_code == 422


def test_finished_game(client, monkeypatch):
    monkeypatch.setattr(
        client.app.state.provider,
        "schedule",
        lambda: [{"game_id": "demo-game", "status": 3}],
    )
    assert client.post("/predictions", json=payload()).status_code == 409


def test_upstream_failure(client, monkeypatch):
    def unavailable():
        raise ValueError("NBA data unavailable")

    monkeypatch.setattr(client.app.state.provider, "schedule", unavailable)
    assert client.get("/games").status_code == 502
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("value", ["1", " 1 "])
def test_env_one(monkeypatch, value):
    monkeypatch.setenv("STUB_MODE", value)
    assert isinstance(create_provider(), StubClient)


@pytest.mark.parametrize("value", ["0", " 0 "])
def test_env_zero(monkeypatch, value):
    monkeypatch.setenv("STUB_MODE", value)
    assert isinstance(create_provider(), NBAClient)


@pytest.mark.parametrize(
    "value", ["true", "false", "yes", "no", "on", "off", "", "2", "typo"]
)
def test_bad_env_fails_closed(monkeypatch, value):
    monkeypatch.setenv("STUB_MODE", value)
    with pytest.raises(ValueError, match="STUB_MODE"):
        create_provider()


def test_cli_uses_stub(monkeypatch, capsys):
    monkeypatch.setenv("STUB_MODE", "1")
    monkeypatch.setattr(
        NBAClient, "request", lambda *args: pytest.fail("Unexpected HTTP")
    )
    monkeypatch.setattr(
        "sys.argv",
        ["bpps", "players", "--team-id", "1610612747", "--season", current_season()],
    )
    from bpps.cli import main

    assert main() == 0
    assert "demo-player" in capsys.readouterr().out


def test_env_unset_defaults_to_live(monkeypatch):
    monkeypatch.delenv("STUB_MODE", raising=False)
    assert isinstance(create_provider(), NBAClient)


def test_forecasts_saved_reopened_and_refreshed(client, monkeypatch):
    from bpps.api import create_app
    from bpps.model import GameLog

    first = client.post("/predictions", json=payload()).json()
    second = client.post("/predictions", json=payload(minutes=10)).json()
    assert first["forecast_id"] != second["forecast_id"]
    report = client.get("/forecasts?limit=1").json()
    assert report["total"] == 2
    assert report["forecasts"][0]["inputs"]["minutes"] == 10
    assert report["forecasts"][0]["primary"] is False
    assert report["summary"]["tracked_games"] == 1
    with TestClient(create_app(include_ui=False)) as reopened:
        assert reopened.get("/forecasts").json()["total"] == 2
    provider = client.app.state.provider
    game = provider.schedule()[0]
    game["status"] = 3
    monkeypatch.setattr(provider, "schedule", lambda: [game])
    outcome = GameLog(
        "demo-player",
        "demo-game",
        datetime.now(UTC).date(),
        "LAL",
        "BOS",
        True,
        30,
        22,
        5,
        6,
        1,
        0,
    )
    monkeypatch.setattr(provider, "logs", lambda *args: [outcome])
    refreshed = client.post("/forecasts/refresh").json()
    assert refreshed["updated_forecasts"] == 2
    assert refreshed["errors"] == []
    history = client.get("/forecasts").json()
    assert history["summary"]["evaluated_games"] == 1
    assert history["forecasts"][0]["outcome"]["stats"]["points"] == 22
    original = history["forecasts"][1]["prediction"]
    assert original["stats"] == first["stats"]
    assert original["model"] == first["model"]
    assert "forecast_id" not in original


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_forecast_pagination_validation(client, query):
    assert client.get(f"/forecasts?{query}").status_code == 422


def test_training_crossing_tipoff_cannot_save_forecast(client, monkeypatch):
    checks = 0

    def guard(game):
        nonlocal checks
        checks += 1
        if checks == 2:
            raise ValueError("Game tipoff has passed")

    monkeypatch.setattr("bpps.service.require_pregame", guard)
    assert client.post("/predictions", json=payload()).status_code == 409
    assert client.get("/forecasts").json()["total"] == 0


def test_forecast_storage_failure_is_explicit(client, monkeypatch):
    import sqlite3

    def fail(*args):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(client.app.state.forecasts, "save", fail)
    response = client.post("/predictions", json=payload())
    assert response.status_code == 503
    assert "storage is unavailable" in response.json()["detail"]


def test_player_research_stub_resolves_context_without_training(client):
    response = client.post(
        "/player-research",
        json={"player_id": "demo-player", "game_id": "demo-game"},
    )
    assert response.status_code == 200
    report = response.json()
    assert report["stub_mode"] is True
    assert report["availability"] == "unknown"
    assert report["context"]["player_name"] == "Demo Lakers Player"
    assert report["context"]["team"] == "LAL"
    assert report["context"]["opponent"] == "BOS"
    assert report["sources"] == []
    assert client.app.state.service.engines == {}
    assert client.get("/forecasts").json()["total"] == 0


@pytest.mark.parametrize(
    "body,status",
    [
        ({"player_id": "missing", "game_id": "demo-game"}, 422),
        ({"player_id": "demo-player", "game_id": "missing"}, 404),
        ({"player_id": "", "game_id": "demo-game"}, 422),
        ({"player_id": "demo-player", "game_id": "demo-game", "name": "Fake"}, 422),
    ],
)
def test_player_research_validates_identity(client, body, status):
    assert client.post("/player-research", json=body).status_code == status


def test_player_research_failure_does_not_break_predictions(client, monkeypatch):
    from bpps.research import ResearchUnavailable

    async def fail(context):
        raise ResearchUnavailable("Player research timed out. Try again.")

    monkeypatch.setattr(client.app.state.research, "research", fail)
    response = client.post(
        "/player-research",
        json={"player_id": "demo-player", "game_id": "demo-game"},
    )
    assert response.status_code == 503
    assert "timed out" in response.json()["detail"]
    assert client.post("/predictions", json=payload()).status_code == 200
