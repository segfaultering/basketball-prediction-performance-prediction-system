import argparse
import json
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime
from pathlib import Path

from .data import read_logs
from .model import backtest, predict
from .providers import create_provider


def main():
    parser = argparse.ArgumentParser(
        description="NBA player points, rebounds, assists and steals predictions"
    )
    parser.add_argument("--cache-dir", default=".cache/bpps")
    parser.add_argument(
        "--refresh", action="store_true", help="Bypass NBA response cache"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    games = commands.add_parser("games", help="List scheduled games (dates in UTC)")
    games.add_argument(
        "--date", type=date.fromisoformat, default=datetime.now(UTC).date()
    )
    games.add_argument("--schedule", type=Path)
    roster = commands.add_parser("players", help="List roster for a team")
    roster.add_argument("--team-id", required=True)
    roster.add_argument("--season", required=True, help="For example 2025-26")
    sync = commands.add_parser("sync", help="Download player history to CSV")
    sync.add_argument("--player-id", required=True)
    sync.add_argument("--season", required=True)
    sync.add_argument(
        "--season-type",
        default="Regular Season",
        choices=["Regular Season", "Playoffs", "Pre Season"],
    )
    sync.add_argument("--output", type=Path, required=True)
    for name in ("predict", "backtest"):
        command = commands.add_parser(name)
        command.add_argument("--player-id", required=True)
        command.add_argument("--csv", type=Path, required=True)
        if name == "predict":
            command.add_argument("--game-id", required=True)
            command.add_argument(
                "--team", required=True, help="Player's team tricode, e.g. LAL"
            )
            command.add_argument(
                "--schedule",
                type=Path,
                help="Local normalized JSON schedule; otherwise fetch NBA",
            )
            command.add_argument(
                "--minutes", type=float, help="Override estimated minutes (0–48)"
            )
    args = parser.parse_args()
    client = create_provider(args.cache_dir, args.refresh)
    try:
        if args.command in ("games", "predict"):
            schedule = (
                json.loads(args.schedule.read_text())
                if args.schedule
                else client.schedule()
            )
        if args.command == "games":
            result = [
                g
                for g in schedule
                if g["date"] == args.date.isoformat() and g["status"] == 1
            ]
        elif args.command == "players":
            result = client.roster(args.team_id, args.season)
        elif args.command == "sync":
            import csv

            logs = client.logs(args.player_id, args.season, args.season_type)
            if not logs:
                raise ValueError(
                    "No history returned; check player, season and season type"
                )
            with args.output.open("w", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=list(asdict(logs[0])))
                writer.writeheader()
                writer.writerows(asdict(g) for g in logs)
            result = {"output": str(args.output), "games": len(logs)}
        elif args.command == "backtest":
            result = backtest(read_logs(args.csv), args.player_id)
        else:
            game = next(
                (g for g in schedule if str(g["game_id"]) == args.game_id), None
            )
            if game is None:
                raise ValueError("Game ID is not in the schedule")
            if game["status"] != 1:
                raise ValueError("Select a scheduled game that has not started")
            team = args.team.upper()
            if team not in (game["home_team"], game["away_team"]):
                raise ValueError("Player team is not participating in this game")
            # Current roster validates membership for live mode; offline mode is user-supplied.
            if not args.schedule:
                game_date = date.fromisoformat(game["date"])
                start = game_date.year if game_date.month >= 7 else game_date.year - 1
                season = f"{start}-{str(start + 1)[-2:]}"
                team_id = (
                    game["home_team_id"]
                    if team == game["home_team"]
                    else game["away_team_id"]
                )
                roster = client.roster(team_id, season)
                if not any(str(p["PLAYER_ID"]) == args.player_id for p in roster):
                    raise ValueError("Player is not on this team's current roster")
            home = team == game["home_team"]
            result = predict(
                read_logs(args.csv),
                args.player_id,
                date.fromisoformat(game["date"]),
                game["away_team"] if home else game["home_team"],
                home,
                args.minutes,
            )
            result["game_id"] = args.game_id
            result["team"] = team
            result["roster_verified"] = not bool(args.schedule)
            if args.schedule:
                result["warnings"].append(
                    "Offline mode: player/team membership is user-supplied."
                )
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError, TypeError, StopIteration) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0
