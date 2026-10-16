"""Build a portable historical replay from auditable NBA game-log snapshots."""

import argparse
import hashlib
import json
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

from nba_api.stats.static import teams

from .baseline import validate_logs
from .data import read_logs
from .model import STATS
from .prediction_engine import PredictionEngine
from .settings import PROJECT_ROOT


def build_snapshot(history_path: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text())
    if (
        hashlib.sha256(history_path.read_bytes()).hexdigest()
        != manifest["history_sha256"]
    ):
        raise ValueError("Replay history does not match its provenance manifest")
    target = date.fromisoformat(manifest["date"])
    logs = read_logs(history_path)
    if any(game.date > target for game in logs):
        raise ValueError("Replay history contains games after the snapshot date")
    identifiers = {t["abbreviation"]: str(t["id"]) for t in teams.get_teams()}
    games: dict[str, dict] = {}
    rosters: dict[str, list[dict]] = {}
    predictions: dict[str, dict] = {}
    backtests: dict[str, dict] = {}
    outcomes: dict[str, dict] = {}
    with tempfile.TemporaryDirectory() as directory:
        engine = PredictionEngine(Path(directory), source="replay")
        for player in manifest["players"]:
            player_id = player["player_id"]
            history = validate_logs(logs, player_id)
            appearances = [g for g in history if g.date == target]
            if len(appearances) != 1:
                raise ValueError(f"Expected one replay appearance for {player_id}")
            actual = appearances[0]
            home = actual.team if actual.home else actual.opponent
            away = actual.opponent if actual.home else actual.team
            game = {
                "game_id": actual.game_id,
                "date": target.isoformat(),
                "status": 3,
                "home_team": home,
                "away_team": away,
                "home_team_id": identifiers[home],
                "away_team_id": identifiers[away],
                "replay_mode": True,
            }
            if actual.game_id in games and games[actual.game_id] != game:
                raise ValueError("Conflicting replay matchup identities")
            games[actual.game_id] = game
            for team in (home, away):
                rosters.setdefault(identifiers[team], [])
            rosters[identifiers[actual.team]].append(
                {
                    "PLAYER_ID": player_id,
                    "PLAYER": player["name"],
                    "POSITION": player["position"],
                }
            )
            prepared = engine.prepare(
                history, player_id, target, actual.opponent, actual.home
            )
            default = prepared.prediction()
            default.update(
                game_id=actual.game_id,
                team=actual.team,
                player_name=player["name"],
                stub_mode=False,
                replay_mode=True,
                roster_verified=False,
            )
            default["warnings"].insert(
                0,
                "Historical replay rebuilt after the game; this is not a forecast saved before tipoff.",
            )
            scenarios = {}
            for minutes in range(49):
                result = prepared.prediction(minutes)
                scenarios[str(minutes)] = {
                    "projected_minutes": result["projected_minutes"],
                    "stats": result["stats"],
                    "baseline": result["baseline"],
                }
            predictions[player_id] = {"default": default, "scenarios": scenarios}
            prior = [g for g in history if g.date < target and g.minutes > 0][-80:]
            backtests[player_id] = {
                **engine.backtest(prior, player_id),
                "stub_mode": False,
                "replay_mode": True,
                "evaluation_scope": f"Prepared expanding-window backtest using the last {len(prior)} positive-minute appearances before {target}; not a full-career evaluation.",
            }
            outcomes[player_id] = {
                "game_id": actual.game_id,
                "date": actual.date.isoformat(),
                "minutes": actual.minutes,
                "stats": {stat: getattr(actual, stat) for stat in STATS},
            }
            print(f"Prepared {player['name']}", flush=True)
    return {
        "version": 1,
        "date": manifest["date"],
        "date_basis": manifest["date_basis"],
        "source": manifest["source"],
        "history_sha256": manifest["history_sha256"],
        "sources": [
            {"player_id": p["player_id"], "url": p["source_url"]}
            for p in manifest["players"]
        ],
        "games": list(games.values()),
        "rosters": rosters,
        "predictions": predictions,
        "backtests": backtests,
        "outcomes": outcomes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--history", type=Path, default=PROJECT_ROOT / "examples/replay/history.csv"
    )
    parser.add_argument(
        "--manifest", type=Path, default=PROJECT_ROOT / "examples/replay/manifest.json"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "frontend/public/replay/snapshot.json",
    )
    args = parser.parse_args()
    snapshot = build_snapshot(args.history, args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, separators=(",", ":"), allow_nan=False) + "\n"
    )
    print(f"Saved replay to {args.output}")


if __name__ == "__main__":
    main()
