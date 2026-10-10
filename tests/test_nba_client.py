from datetime import date
from types import SimpleNamespace

import pytest
from requests.exceptions import ReadTimeout

from bpps.data import NBAClient


def table(rows):
    headers = list(rows[0]) if rows else []
    return SimpleNamespace(
        get_dict=lambda: {"headers": headers, "data": [list(r.values()) for r in rows]}
    )


def test_career_history_uses_player_debut_and_long_lived_completed_cache(
    tmp_path, monkeypatch
):
    def info(**kwargs):
        assert kwargs == {
            "player_id": "201939",
            "league_id_nullable": "00",
            "timeout": 20,
        }
        return SimpleNamespace(common_player_info=table([{"FROM_YEAR": 2022}]))

    calls = []

    def logs(player_id, season, season_type, ttl):
        calls.append((player_id, season, season_type, ttl))
        return []

    monkeypatch.setattr("bpps.data.commonplayerinfo.CommonPlayerInfo", info)
    client = NBAClient(tmp_path)
    monkeypatch.setattr(client, "logs", logs)
    assert client.career_logs("201939", date(2024, 3, 1)) == []
    assert calls == [
        ("201939", "2022-23", "Regular Season", 365 * 86400),
        ("201939", "2023-24", "Regular Season", 365 * 86400),
    ]


def test_incomplete_career_download_fails_explicitly(tmp_path, monkeypatch):
    client = NBAClient(tmp_path)
    monkeypatch.setattr(
        client, "request", lambda *args, **kwargs: [{"FROM_YEAR": 2022}]
    )

    def unavailable(*args, **kwargs):
        raise ValueError("blocked")

    monkeypatch.setattr(client, "logs", unavailable)
    with pytest.raises(ValueError, match="Incomplete career history at 2022-23"):
        client.career_logs("201939", date(2024, 3, 1))


def test_roster_package_parameters_and_cache(tmp_path, monkeypatch):
    calls = []

    def roster(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            common_team_roster=table([{"PLAYER_ID": 2544, "PLAYER": "LeBron James"}])
        )

    monkeypatch.setattr("bpps.data.commonteamroster.CommonTeamRoster", roster)
    client = NBAClient(tmp_path)
    assert client.roster("1610612747", "2025-26")[0]["PLAYER_ID"] == 2544
    client.roster("1610612747", "2025-26")
    assert len(calls) == 1
    assert calls[0] == {
        "team_id": "1610612747",
        "season": "2025-26",
        "league_id_nullable": "00",
        "timeout": 20,
    }
    client.refresh = True
    client.roster("1610612747", "2025-26")
    assert len(calls) == 2
    client.refresh = False
    next(tmp_path.glob("*.json")).write_text("corrupt json")
    client.roster("1610612747", "2025-26")
    assert len(calls) == 3


def test_schedule_uses_package_dataset(tmp_path, monkeypatch):
    def schedule(**kwargs):
        assert kwargs == {"season": "2026-27", "league_id": "00", "timeout": 20}
        return SimpleNamespace(
            season_games=table(
                [
                    {
                        "gameId": "0022600001",
                        "gameDateTimeUTC": "2026-10-20T23:30:00Z",
                        "gameStatus": 1,
                        "homeTeam_teamTricode": "LAL",
                        "homeTeam_teamId": 1610612747,
                        "awayTeam_teamTricode": "BOS",
                        "awayTeam_teamId": 1610612738,
                    }
                ]
            )
        )

    monkeypatch.setattr("bpps.data.scheduleleaguev2.ScheduleLeagueV2", schedule)
    game = NBAClient(tmp_path).schedule("2026-27")[0]
    assert game["date"] == "2026-10-20"
    assert game["game_id"] == "0022600001"
    assert game["away_team_id"] == "1610612738"


def test_player_history_parameters_and_conversion(tmp_path, monkeypatch):
    def logs(**kwargs):
        assert kwargs == {
            "player_id": "2544",
            "season": "2025-26",
            "season_type_all_star": "Playoffs",
            "league_id_nullable": "00",
            "timeout": 20,
        }
        return SimpleNamespace(
            player_game_log=table(
                [
                    {
                        "Game_ID": "0022500001",
                        "GAME_DATE": "OCT 20, 2025",
                        "MATCHUP": "LAL @ BOS",
                        "MIN": 32,
                        "PTS": 24,
                        "REB": 8,
                        "AST": 6,
                        "STL": 2,
                        "BLK": 3,
                    }
                ]
            )
        )

    monkeypatch.setattr("bpps.data.playergamelog.PlayerGameLog", logs)
    log = NBAClient(tmp_path).logs("2544", "2025-26", "Playoffs")[0]
    assert log.date.isoformat() == "2025-10-20"
    assert log.game_id == "0022500001"
    assert log.blocks == 3
    assert log.points == 24
    assert log.opponent == "BOS"
    assert log.home is False


def test_upstream_timeout_not_cached(tmp_path, monkeypatch):
    def unavailable(**kwargs):
        raise ReadTimeout("NBA timed out")

    monkeypatch.setattr("bpps.data.commonteamroster.CommonTeamRoster", unavailable)
    with pytest.raises(ValueError, match="NBA data unavailable via nba_api"):
        NBAClient(tmp_path).roster("1610612747", "2025-26")
    assert not list(tmp_path.glob("*.json"))


def test_empty_history(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "bpps.data.playergamelog.PlayerGameLog",
        lambda **kwargs: SimpleNamespace(player_game_log=table([])),
    )
    assert NBAClient(tmp_path).logs("2544", "2025-26") == []
