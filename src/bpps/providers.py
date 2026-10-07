"""Choose an entirely local provider when STUB_MODE is enabled."""

import os
from datetime import UTC, date, datetime, timedelta

from .data import NBAClient
from .model import GameLog


def stub_enabled():
    value = os.getenv("STUB_MODE", "0").strip()
    if value == "1":
        return True
    if value == "0":
        return False
    raise ValueError("STUB_MODE must be 0 (live NBA data) or 1 (synthetic local data)")


class StubClient:
    """Synthetic fixtures generated locally; no HTTP or cache access."""

    def schedule(self):
        today = datetime.now(UTC).date()
        return [
            {
                "game_id": "demo-game",
                "date": today.isoformat(),
                "status": 1,
                "tipoff_utc": today.isoformat() + "T23:30:00Z",
                "home_team": "LAL",
                "away_team": "BOS",
                "home_team_id": "1610612747",
                "away_team_id": "1610612738",
            }
        ]

    def roster(self, team_id, season):
        players = {
            "1610612747": ("demo-player", "Demo Lakers Player"),
            "1610612738": ("demo-celtics-player", "Demo Celtics Player"),
        }
        if str(team_id) not in players:
            return []
        player_id, name = players[str(team_id)]
        return [
            {
                "PLAYER_ID": player_id,
                "PLAYER": name,
                "TeamID": str(team_id),
                "SEASON": season,
                "POSITION": "G",
            }
        ]

    def logs(self, player_id, season, season_type="Regular Season"):
        if player_id not in {"demo-player", "demo-celtics-player"}:
            return []
        start = int(season[:4])
        today = datetime.now(UTC).date()
        # Current-season fixtures precede today's scheduled demo; past seasons
        # get their own dates so combining seasons cannot duplicate game IDs.
        end = min(today - timedelta(days=1), date(start + 1, 6, 1))
        if end < date(start, 7, 1):
            return []
        team = "LAL" if player_id == "demo-player" else "BOS"
        return [
            GameLog(
                player_id,
                f"stub-{season}-{season_type}-{i}",
                end - timedelta(days=(23 - i) * 2),
                team,
                ["NYK", "GSW", "BOS" if team == "LAL" else "LAL"][i % 3],
                i % 2 == 0,
                30 + i % 7,
                18 + i % 13,
                4 + i % 6,
                3 + i % 7,
                i % 4,
            )
            for i in range(24)
        ]


def create_provider(cache_dir=".cache/bpps", refresh=False):
    return StubClient() if stub_enabled() else NBAClient(cache_dir, refresh)
