"""CSV ingestion and cached NBA JSON access; no third-party dependencies."""

import csv
import hashlib
import json
import time
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .model import GameLog


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
                        for s in ("minutes", "points", "rebounds", "assists", "steals")
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

    def fetch(self, url, ttl=3600):
        path = self.cache_dir / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        if (
            not self.refresh
            and path.exists()
            and time.time() - path.stat().st_mtime < ttl
        ):
            return json.loads(path.read_text())
        request = Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.nba.com/",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                data = json.load(response)
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"NBA data unavailable: {exc}. Retry later or use --csv/local schedule."
            ) from exc
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return data

    def stats(self, endpoint, params, dataset):
        data = self.fetch(
            "https://stats.nba.com/stats/" + endpoint + "?" + urlencode(params)
        )
        for table in data["resultSets"]:
            if table["name"] == dataset:
                return [dict(zip(table["headers"], row)) for row in table["rowSet"]]
        raise ValueError(f"NBA response missing {dataset}")

    def schedule(self):
        data = self.fetch(
            "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"
        )
        return [
            {
                "game_id": g["gameId"],
                "date": g["gameDateTimeUTC"][:10],
                "tipoff_utc": g["gameDateTimeUTC"],
                "status": g["gameStatus"],
                "home_team": g["homeTeam"]["teamTricode"],
                "away_team": g["awayTeam"]["teamTricode"],
                "home_team_id": str(g["homeTeam"]["teamId"]),
                "away_team_id": str(g["awayTeam"]["teamId"]),
            }
            for day in data["leagueSchedule"]["gameDates"]
            for g in day["games"]
        ]

    def roster(self, team_id, season):
        return self.stats(
            "commonteamroster",
            {"TeamID": team_id, "Season": season, "LeagueID": "00"},
            "CommonTeamRoster",
        )

    def logs(self, player_id, season, season_type="Regular Season"):
        rows = self.stats(
            "playergamelog",
            {
                "PlayerID": player_id,
                "Season": season,
                "SeasonType": season_type,
                "LeagueID": "00",
                "DateFrom": "",
                "DateTo": "",
            },
            "PlayerGameLog",
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
                *(float(r[s]) for s in ("MIN", "PTS", "REB", "AST", "STL")),
            )
            for r in rows
        ]
