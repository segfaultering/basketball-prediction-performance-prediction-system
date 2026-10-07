import json
from dataclasses import replace
from datetime import date, timedelta

import pytest

from bpps.cli import main
from bpps.data import NBAClient, read_logs
from bpps.model import GameLog, backtest, predict


def history():
    return [
        GameLog(
            "1",
            str(i),
            date(2025, 1, 1) + timedelta(days=i),
            "LAL",
            "BOS",
            True,
            30,
            20,
            6,
            5,
            1,
        )
        for i in range(12)
    ]


def test_constant_history_and_future_leakage():
    logs = history()
    target = date(2025, 1, 10)
    result = predict(logs, "1", target, "BOS", True)
    contaminated = [replace(g, points=1000) if g.date >= target else g for g in logs]
    assert result == predict(contaminated, "1", target, "BOS", True)
    assert result["stats"]["points"]["prediction"] == 20
    assert result["history_games"] == 9


def test_minutes_override_and_cold_start():
    result = predict(history(), "1", date(2025, 2, 1), "BOS", True, 15)
    assert result["stats"]["points"]["prediction"] == 10
    with pytest.raises(ValueError):
        predict(history()[:4], "1", date(2025, 2, 1), "BOS", True)
    with pytest.raises(ValueError):
        predict(history(), "1", date(2025, 2, 1), "BOS", True, float("nan"))


def test_dnp_excluded_and_nonnegative_ranges():
    logs = history() + [replace(history()[0], game_id="dnp", minutes=0, points=0)]
    result = predict(logs, "1", date(2025, 2, 1), "BOS", True, 0)
    assert result["history_games"] == 12
    assert all(
        s["prediction"] == 0 and s["approximate_80pct_range"][0] == 0
        for s in result["stats"].values()
    )


def test_backtest():
    result = backtest(history(), "1")
    assert result["evaluated_games"] == 7
    assert result["stats"]["points"]["mae"] == 0
    assert result["stats"]["points"]["range_coverage"] == 1


def test_invalid_csv(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text(
        "player_id,game_id,date,team,opponent,home,minutes,points,rebounds,assists,steals\n"
        "1,1,2025-01-01,LAL,BOS,maybe,30,20,6,5,1\n"
    )
    with pytest.raises(ValueError, match="row 2"):
        read_logs(path)


def test_nba_schedule_normalization(monkeypatch):
    client = NBAClient()
    monkeypatch.setattr(
        client,
        "request",
        lambda *args: [
            {
                "gameId": "001",
                "gameDateTimeUTC": "2026-10-20T23:30:00Z",
                "gameStatus": 1,
                "homeTeam_teamTricode": "LAL",
                "homeTeam_teamId": 1,
                "awayTeam_teamTricode": "BOS",
                "awayTeam_teamId": 2,
            }
        ],
    )
    assert client.schedule()[0]["date"] == "2026-10-20"


def test_cli_offline(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv",
        [
            "bpps",
            "predict",
            "--csv",
            "examples/history.csv",
            "--schedule",
            "examples/schedule.json",
            "--game-id",
            "demo-game",
            "--player-id",
            "demo-player",
            "--team",
            "LAL",
        ],
    )
    assert main() == 0
    result = json.loads(capsys.readouterr().out)
    assert not result["roster_verified"]
    assert set(result["stats"]) == {"points", "rebounds", "assists", "steals"}


def test_invalid_team(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv",
        [
            "bpps",
            "predict",
            "--csv",
            "examples/history.csv",
            "--schedule",
            "examples/schedule.json",
            "--game-id",
            "demo-game",
            "--player-id",
            "demo-player",
            "--team",
            "NYK",
        ],
    )
    assert main() == 1
    assert "not participating" in capsys.readouterr().err
