"""Command parsing and presentation for shared prediction workflows."""

import argparse
import csv
import json
import sqlite3
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime
from pathlib import Path

from .data import read_logs
from .learning import create_backend
from .prediction_engine import PredictionEngine
from .providers import DataProvider, create_provider
from .seasons import season_name, season_start, validate_season
from .service import PredictionRequest, PredictionService
from .settings import Settings
from .tracking import ForecastStore


def build_parser() -> argparse.ArgumentParser:
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
    roster.add_argument(
        "--season", required=True, type=validate_season, help="For example 2025-26"
    )
    sync = commands.add_parser("sync", help="Download player history to CSV")
    sync.add_argument("--player-id", required=True)
    sync.add_argument("--season", required=True, type=validate_season)
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
    return parser


def model_cache(args: argparse.Namespace, config: Settings) -> Path:
    return (Path(args.cache_dir) if args.cache_dir else config.cache_dir) / "models"


def model_engine(args: argparse.Namespace, config: Settings) -> PredictionEngine:
    return PredictionEngine(
        model_cache(args, config),
        source="csv" if args.csv else "stub" if config.stub_mode else "nba",
        season_type=args.season_type,
        backend=create_backend(args.backend or config.model_backend),
    )


def history(args: argparse.Namespace, provider: DataProvider, through: date):
    return (
        read_logs(args.csv)
        if args.csv
        else provider.career_logs(args.player_id, through, args.season_type)
    )


def forecast_store(config: Settings) -> ForecastStore:
    return ForecastStore(config.forecast_db, "stub" if config.stub_mode else "nba")


def list_games(args, config, provider):
    schedule = (
        json.loads(args.schedule.read_text())
        if args.schedule
        else provider.schedule(season_name(season_start(args.date)))
    )
    return [
        g for g in schedule if g["date"] == args.date.isoformat() and g["status"] == 1
    ]


def list_players(args, config, provider):
    return provider.roster(args.team_id, args.season)


def sync_history(args, config, provider):
    logs = provider.logs(args.player_id, args.season, args.season_type)
    if not logs:
        raise ValueError("No history returned; check player, season and season type")
    with args.output.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(asdict(logs[0])))
        writer.writeheader()
        writer.writerows(asdict(game) for game in logs)
    return {"output": str(args.output), "games": len(logs)}


def list_forecasts(args, config, provider):
    if not 1 <= args.limit <= 100 or args.offset < 0:
        raise ValueError("Limit must be 1–100 and offset must be nonnegative")
    store = forecast_store(config)
    refreshed = store.refresh(provider) if args.refresh_results else None
    result = store.report(args.limit, args.offset)
    if refreshed is not None:
        result["refresh"] = refreshed
    return result


def backtest(args, config, provider):
    logs = history(args, provider, datetime.now(UTC).date())
    return model_engine(args, config).backtest(logs, args.player_id)


def train(args, config, provider):
    logs = history(args, provider, args.as_of)
    artifact = model_engine(args, config).train(
        logs, args.player_id, args.as_of, refresh=args.refresh
    )
    result = {key: value for key, value in artifact.items() if key != "stats"}
    result["stats"] = {
        stat: {key: value for key, value in entry.items() if key != "model"}
        for stat, entry in artifact["stats"].items()
    }
    return result


def predict(args, config, provider):
    service = PredictionService(
        provider,
        model_cache(args, config),
        args.backend or config.model_backend,
        forecast_store(config),
    )
    team = args.team.upper()
    if not args.csv and not args.schedule:
        return service.prediction(
            PredictionRequest(
                player_id=args.player_id,
                game_id=args.game_id,
                minutes=args.minutes,
                season_type=args.season_type,
            ),
            team=team,
        )
    # Local experiments use the same engine but do not archive forecasts.
    if args.schedule:
        schedule = json.loads(args.schedule.read_text())
        game = next((g for g in schedule if str(g["game_id"]) == args.game_id), None)
        if game is None:
            raise ValueError("Game ID is not in the schedule")
        if game["status"] != 1:
            raise ValueError("Select a scheduled game that has not started")
        if team not in (game["home_team"], game["away_team"]):
            raise ValueError("Player team is not participating in this game")
        game_date = date.fromisoformat(game["date"])
        home = team == game["home_team"]
    else:
        game, game_date, home, _ = service.player_context(
            args.player_id, args.game_id, team
        )
    result = model_engine(args, config).prediction(
        history(args, provider, game_date),
        args.player_id,
        game_date,
        game["away_team" if home else "home_team"],
        home,
        args.minutes,
    )
    result.update(
        game_id=args.game_id, team=team, roster_verified=not bool(args.schedule)
    )
    if args.schedule:
        result["warnings"].append(
            "Offline mode: player/team membership is user-supplied."
        )
    return result


COMMANDS = {
    "games": list_games,
    "players": list_players,
    "sync": sync_history,
    "forecasts": list_forecasts,
    "backtest": backtest,
    "train": train,
    "predict": predict,
}


def main() -> int:
    args = build_parser().parse_args()
    try:
        config = Settings()
        provider = create_provider(args.cache_dir, args.refresh, settings=config)
        result = COMMANDS[args.command](args, config, provider)
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
