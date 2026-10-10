"""CSV ingestion and cached NBA access through nba_api."""

import csv
import hashlib
import json
import time
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, NotRequired, TypedDict

from nba_api.stats.endpoints import (
    commonplayerinfo,
    commonteamroster,
    playergamelog,
    scheduleleaguev2,
)
from requests.exceptions import RequestException

from .model import GameLog


class ScheduledGame(TypedDict):
    game_id: str
    date: str
    status: int
    home_team: str
    away_team: str
    home_team_id: NotRequired[str]
    away_team_id: NotRequired[str]
    tipoff_utc: NotRequired[str]


def read_logs(path):
    result = []
    seen = set()
    with open(path, newline="") as source:
        for line, row in enumerate(csv.DictReader(source), 2):
            try:
                if row["home"].lower() not in ("true", "false", "1", "0"):
                    raise ValueError("home must be true/false or 1/0")
                game = GameLog(
                    str(row["player_id"]),
                    row["game_id"],
                    date.fromisoformat(row["date"]),
                    row["team"],
                    row["opponent"],
                    row["home"].lower() in ("true", "1"),
                    *(
                        float(row[s])
                        for s in (
                            "minutes",
                            "points",
                            "rebounds",
                            "assists",
                            "steals",
                            "blocks",
                        )
                    ),
                )
                key = (game.player_id, game.game_id)
                if key in seen:
                    raise ValueError("Duplicate player/game")
                seen.add(key)
                result.append(game)
            except (KeyError, ValueError) as exc:
                raise ValueError(f"Invalid CSV row {line}: {exc}") from exc
    return result


class NBAClient:
    def __init__(self, cache_dir=".cache/bpps", refresh=False):
        self.cache_dir = Path(cache_dir)
        self.refresh = refresh

    def request(
        self, endpoint: Callable[..., Any], params: dict, dataset: str, ttl=3600
    ):
        # Version the cache namespace so old direct-HTTP payloads are never reused.
        key = json.dumps(
            ["nba_api-v1", endpoint.__name__, params, dataset], sort_keys=True
        )
        path = self.cache_dir / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        if (
            not self.refresh
            and path.exists()
            and time.time() - path.stat().st_mtime < ttl
        ):
            try:
                cached = json.loads(path.read_text())
                if isinstance(cached, list):
                    return cached
            except OSError, ValueError:
                pass  # Corrupt cache entries are refetched.
        try:
            response = endpoint(**params, timeout=20)
            attribute = {
                "SeasonGames": "season_games",
                "CommonTeamRoster": "common_team_roster",
                "PlayerGameLog": "player_game_log",
                "CommonPlayerInfo": "common_player_info",
            }[dataset]
            table = getattr(response, attribute).get_dict()
            rows = [
                dict(zip(table["headers"], row, strict=True)) for row in table["data"]
            ]
        except (
            RequestException,
            TimeoutError,
            ValueError,
            KeyError,
            TypeError,
            IndexError,
        ) as exc:
            raise ValueError(
                f"NBA data unavailable via nba_api ({dataset}): {exc}. "
                "The NBA may be blocking requests; retry later or use STUB_MODE=1."
            ) from exc
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows))
        return rows

    def schedule(self, season: str | None = None) -> list[ScheduledGame]:
        if season is None:
            today = datetime.now(UTC).date()
            start = today.year if today.month >= 7 else today.year - 1
            season = f"{start}-{str(start + 1)[-2:]}"
        rows = self.request(
            scheduleleaguev2.ScheduleLeagueV2,
            {"season": season, "league_id": "00"},
            "SeasonGames",
        )
        try:
            return [
                {
                    "game_id": str(g["gameId"]),
                    "date": g["gameDateTimeUTC"][:10],
                    "tipoff_utc": g["gameDateTimeUTC"],
                    "status": int(g["gameStatus"]),
                    "home_team": g["homeTeam_teamTricode"],
                    "away_team": g["awayTeam_teamTricode"],
                    "home_team_id": str(g["homeTeam_teamId"]),
                    "away_team_id": str(g["awayTeam_teamId"]),
                }
                for g in rows
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid NBA schedule response: {exc}") from exc

    def roster(self, team_id, season):
        return self.request(
            commonteamroster.CommonTeamRoster,
            {"team_id": team_id, "season": season, "league_id_nullable": "00"},
            "CommonTeamRoster",
        )

    def logs(self, player_id, season, season_type="Regular Season", ttl=3600):
        rows = self.request(
            playergamelog.PlayerGameLog,
            {
                "player_id": player_id,
                "season": season,
                "season_type_all_star": season_type,
                "league_id_nullable": "00",
            },
            "PlayerGameLog",
            ttl=ttl,
        )
        return [
            GameLog(
                str(player_id),
                str(r["Game_ID"]),
                datetime.strptime(r["GAME_DATE"], "%b %d, %Y")
                .replace(tzinfo=UTC)
                .date(),
                r["MATCHUP"][:3],
                r["MATCHUP"][-3:],
                "vs." in r["MATCHUP"],
                *(float(r[s]) for s in ("MIN", "PTS", "REB", "AST", "STL", "BLK")),
            )
            for r in rows
        ]

    def career_logs(
        self, player_id: str, through: date, season_type: str = "Regular Season"
    ) -> list[GameLog]:
        info = self.request(
            commonplayerinfo.CommonPlayerInfo,
            {"player_id": player_id, "league_id_nullable": "00"},
            "CommonPlayerInfo",
            ttl=86400,
        )
        if not info:
            return []
        try:
            first = int(info[0]["FROM_YEAR"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                "NBA player information has no valid career start"
            ) from exc
        last = through.year if through.month >= 7 else through.year - 1
        if not 1946 <= first <= last:
            raise ValueError("NBA player information has an invalid career start")
        today = datetime.now(UTC).date()
        current = today.year if today.month >= 7 else today.year - 1
        logs: list[GameLog] = []
        for year in range(first, last + 1):
            season = f"{year}-{(year + 1) % 100:02d}"
            try:
                logs.extend(
                    self.logs(
                        player_id,
                        season,
                        season_type,
                        ttl=3600 if year >= current else 365 * 86400,
                    )
                )
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError(
                    f"Incomplete career history at {season}: {exc}"
                ) from exc
        return logs
