from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from bpps.providers import NBAClient, StubClient, create_provider


def current_season():
    today = datetime.now(UTC).date()
    start = today.year if today.month >= 7 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "true")

    def forbidden(*args, **kwargs):
        pytest.fail("Stub mode attempted an external NBA request")

    monkeypatch.setattr("bpps.data.urlopen", forbidden)
    monkeypatch.setattr(NBAClient, "fetch", forbidden)
    from bpps.api import create_app

    with TestClient(create_app()) as test_client:
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


@pytest.mark.parametrize("value", ["true", "1", "YES", " on "])
def test_env_true(monkeypatch, value):
    monkeypatch.setenv("STUB_MODE", value)
    assert isinstance(create_provider(), StubClient)


@pytest.mark.parametrize("value", ["false", "0", "no", "off", ""])
def test_env_false(monkeypatch, value):
    monkeypatch.setenv("STUB_MODE", value)
    assert isinstance(create_provider(), NBAClient)


def test_bad_env_fails_closed(monkeypatch):
    monkeypatch.setenv("STUB_MODE", "typo")
    with pytest.raises(ValueError, match="STUB_MODE"):
        create_provider()


def test_cli_uses_stub(monkeypatch, capsys):
    monkeypatch.setenv("STUB_MODE", "true")
    monkeypatch.setattr(
        NBAClient, "fetch", lambda *args: pytest.fail("Unexpected HTTP")
    )
    monkeypatch.setattr(
        "sys.argv",
        ["bpps", "players", "--team-id", "1610612747", "--season", current_season()],
    )
    from bpps.cli import main

    assert main() == 0
    assert "demo-player" in capsys.readouterr().out
