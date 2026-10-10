import argparse
import json
import sqlite3
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime
from pathlib import Path

from .data import ScheduledGame, read_logs
from .learning import create_backend
from .prediction_engine import PredictionEngine
from .providers import create_provider
from .settings import Settings
from .tracking import ForecastStore, require_pregame


def main():
    parser = argparse.ArgumentParser(
        description="NBA player points, rebounds, assists, steals and blocks predictions"
    )
    parser.add_argument("--cache-dir", help="Override PROJ_DIR/.cache/bpps")
    parser.add_argument(
        "--backend", help="Correction model backend (default: MODEL_BACKEND or ridge)"
    )
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
    forecasts = commands.add_parser("forecasts", help="Review saved pregame forecasts")
    forecasts.add_argument("--refresh-results", action="store_true")
    forecasts.add_argument("--limit", type=int, default=50)
    forecasts.add_argument("--offset", type=int, default=0)
    for name in ("predict", "backtest", "train"):
        command = commands.add_parser(name)
        command.add_argument("--player-id", required=True)
        command.add_argument(
            "--csv",
            type=Path,
            help="Optional history override; otherwise retrieve full career",
        )
        command.add_argument(
            "--season-type",
            default="Regular Season",
            choices=["Regular Season", "Playoffs", "Pre Season"],
        )
        if name == "train":
            command.add_argument(
                "--as-of", type=date.fromisoformat, default=datetime.now(UTC).date()
            )
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
    try:
        client = create_provider(args.cache_dir, args.refresh)
        config = Settings()
        store = ForecastStore(config.forecast_db, "stub" if config.stub_mode else "nba")
        engine = None
        if args.command in ("predict", "backtest", "train"):
            engine = PredictionEngine(
                Path(args.cache_dir) / "models"
                if args.cache_dir
                else config.cache_dir / "models",
                source="csv"
                if args.csv
                else "stub"
                if config.stub_mode == 1
                else "nba",
                season_type=args.season_type,
                backend=create_backend(args.backend or config.model_backend),
            )
        schedule: list[ScheduledGame] = []
        if args.command in ("games", "predict"):
            schedule = (
                json.loads(args.schedule.read_text())
                if args.schedule
                else client.schedule()
            )
        if args.command == "forecasts":
            if not 1 <= args.limit <= 100 or args.offset < 0:
                raise ValueError("Limit must be 1–100 and offset must be nonnegative")
            result = store.report(args.limit, args.offset)
            if args.refresh_results:
                refresh_result = store.refresh(client)
                result = store.report(args.limit, args.offset)
                result["refresh"] = refresh_result
        elif args.command == "games":
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
            assert engine is not None
            logs = (
                read_logs(args.csv)
                if args.csv
                else client.career_logs(
                    args.player_id, datetime.now(UTC).date(), args.season_type
                )
            )
            result = engine.backtest(logs, args.player_id)
        elif args.command == "train":
            assert engine is not None
            logs = (
                read_logs(args.csv)
                if args.csv
                else client.career_logs(args.player_id, args.as_of, args.season_type)
            )
            artifact = engine.train(
                logs, args.player_id, args.as_of, refresh=args.refresh
            )
            result = {k: v for k, v in artifact.items() if k != "stats"}
            result["stats"] = {
                s: {k: v for k, v in entry.items() if k != "model"}
                for s, entry in artifact["stats"].items()
            }
        else:
            game = next(
                (g for g in schedule if str(g["game_id"]) == args.game_id), None
            )
            if game is None:
                raise ValueError("Game ID is not in the schedule")
            if game["status"] != 1:
                raise ValueError("Select a scheduled game that has not started")
            team = args.team.upper()
            player_name = args.player_id
            if team not in (game["home_team"], game["away_team"]):
                raise ValueError("Player team is not participating in this game")
            # Current roster validates membership for live mode; offline mode is user-supplied.
            if not args.schedule:
                require_pregame(dict(game))
                game_date = date.fromisoformat(game["date"])
                start = game_date.year if game_date.month >= 7 else game_date.year - 1
                season = f"{start}-{str(start + 1)[-2:]}"
                team_id = (
                    game["home_team_id"]
                    if team == game["home_team"]
                    else game["away_team_id"]
                )
                game_roster = client.roster(team_id, season)
                player = next(
                    (p for p in game_roster if str(p["PLAYER_ID"]) == args.player_id),
                    None,
                )
                if player is None:
                    raise ValueError("Player is not on this team's current roster")
                player_name = player["PLAYER"]
            home = team == game["home_team"]
            assert engine is not None
            target_date = date.fromisoformat(game["date"])
            logs = (
                read_logs(args.csv)
                if args.csv
                else client.career_logs(args.player_id, target_date, args.season_type)
            )
            result = engine.prediction(
                logs,
                args.player_id,
                target_date,
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
            if not args.schedule and not args.csv:
                require_pregame(dict(game))
                result["stub_mode"] = config.stub_mode == 1
                result["player_name"] = player_name
                result["tipoff_utc"] = game.get("tipoff_utc")
                if config.stub_mode:
                    result["warnings"].append(
                        "Synthetic stub data; this is not a real NBA prediction."
                    )
                result.update(
                    store.save(
                        {
                            "player_id": args.player_id,
                            "game_id": args.game_id,
                            "minutes": args.minutes,
                            "seasons": None,
                            "season_type": args.season_type,
                        },
                        result,
                    )
                )
        print(json.dumps(result, indent=2))
    except (
        ValueError,
        OSError,
        KeyError,
        TypeError,
        StopIteration,
        sqlite3.Error,
    ) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0
