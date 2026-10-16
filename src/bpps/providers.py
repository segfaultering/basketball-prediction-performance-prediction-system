"""Choose an entirely local provider when STUB_MODE is enabled."""

from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from .data import NBAClient, ScheduledGame
from .model import GameLog
from .seasons import season_name, season_start
from .settings import Settings


def stub_enabled():
    return Settings().stub_mode == 1


class StubClient:
    """Synthetic fixtures generated locally; no HTTP or cache access."""

    def schedule(self, season: str | None = None) -> list[ScheduledGame]:
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
                i % 3,
            )
            for i in range(24)
        ]

    def career_logs(
        self, player_id: str, through: date, season_type: str = "Regular Season"
    ) -> list[GameLog]:
        last = season_start(through)
        logs: list[GameLog] = []
        for year in range(last - 4, last + 1):
            logs.extend(self.logs(player_id, season_name(year), season_type))
        return logs


class DataProvider(Protocol):
    def schedule(self, season: str | None = None) -> list[ScheduledGame]: ...

    def roster(self, team_id: str, season: str) -> list[dict[str, Any]]: ...

    def logs(
        self, player_id: str, season: str, season_type: str = "Regular Season"
    ) -> list[GameLog]: ...

    def career_logs(
        self, player_id: str, through: date, season_type: str = "Regular Season"
    ) -> list[GameLog]: ...


def create_provider(cache_dir=None, refresh=False, settings: Settings | None = None):
    config = settings if settings is not None else Settings()
    return (
        StubClient()
        if config.stub_mode == 1
        else NBAClient(
            cache_dir if cache_dir is not None else config.cache_dir, refresh
        )
    )
