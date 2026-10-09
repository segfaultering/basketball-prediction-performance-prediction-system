"""Formula checks and chronology invariants for notebook experiments."""

import csv
import json
from dataclasses import asdict, replace
from datetime import date, timedelta

import pytest

from bpps.baseline_research import (
    Candidate,
    build_features,
    candidates,
    load_history,
    rates,
    run_experiment,
    save_results,
    season_start,
    select_candidates,
    synthetic_history,
    validate_logs,
)
from bpps.model import GameLog


def game(day, identifier, minutes=20, points=10):
    return GameLog(
        "1", identifier, day, "GSW", "BOS", True, minutes, points, 4, 3, 1, 0
    )


@pytest.fixture
def dataset():
    return load_history("1", 2022, 2025, source="synthetic")


def test_ratio_of_totals_not_mean_of_rates():
    logs = [game(date(2023, 1, 1), "a", 10, 10), game(date(2023, 1, 2), "b", 30, 0)]
    result = rates(logs)
    assert result is not None
    assert result["points"] == 0.25


def test_blend_and_adaptive_weight():
    prior = [game(date(2023, 1, 1) + timedelta(days=i), str(i)) for i in range(5)]
    current = game(date(2023, 10, 20), "current", 40, 40)
    target = game(date(2023, 10, 22), "target", 48, 100)
    f = build_features(prior + [current, target], "1")[-1]
    assert f.career_rates is not None and f.season_rates is not None
    assert f.career_rates["points"] == 0.5
    assert f.season_rates["points"] == 1
    assert f.estimated_minutes == pytest.approx(140 / 6)
    assert Candidate("career", "fixed", 0.75).estimate(f, "points") == pytest.approx(
        0.875 * 140 / 6
    )
    adaptive = Candidate("career", "adaptive", 100)
    assert adaptive.season_weight(40) == pytest.approx(40 / 140)
    assert adaptive.estimate(f, "points") == pytest.approx(
        (0.5 * 100 / 140 + 40 / 140) * 140 / 6
    )


def test_season_boundary_and_recent_window():
    assert season_start(date(2024, 6, 30)) == 2023
    assert season_start(date(2024, 7, 1)) == 2024
    logs = [game(date(2019, 10, 20), "old", points=100)]
    logs += [game(date(2023, 1, 1) + timedelta(days=i), str(i)) for i in range(5)]
    logs += [game(date(2024, 10, 20), "target")]
    f = build_features(logs, "1")[-1]
    assert f.season_rates is None
    assert f.previous_three_rates is not None and f.career_rates is not None
    assert f.previous_three_rates["points"] == 0.5
    assert f.career_rates["points"] == 1.25
    assert Candidate("previous_three", "fixed", 1).estimate(f, "points") == 10


def test_missing_historical_component_uses_season_rate():
    logs = [game(date(2023, 10, 20) + timedelta(days=i), str(i)) for i in range(6)]
    f = build_features(logs, "1")[0]
    assert f.career_rates is None
    assert Candidate("career", "fixed", 0).estimate(f, "points") == 10


def test_dnp_and_future_outcomes_do_not_affect_features():
    logs = synthetic_history("1", 2022, 2023)
    original = build_features(logs, "1")
    target = original[-10].game
    mutated = [
        replace(g, points=1000, assists=200, minutes=48) if g.date >= target.date else g
        for g in logs
    ]
    f = next(f for f in original if f.game.game_id == target.game_id)
    changed = next(
        f for f in build_features(mutated, "1") if f.game.game_id == target.game_id
    )
    assert replace(changed, game=f.game) == f
    dnp = replace(logs[0], game_id="dnp", minutes=0, points=999)
    assert build_features(logs + [dnp], "1") == original


def test_same_date_outcome_is_not_a_feature():
    logs = [game(date(2023, 1, 1) + timedelta(days=i), str(i)) for i in range(5)]
    target = game(date(2023, 1, 10), "target")
    other = game(target.date, "other", points=999)
    features = build_features(logs + [target, other], "1")
    assert features[-1].estimated_minutes == 20
    assert features[-1].season_rates == rates(logs)


def test_holdout_cannot_change_selection(dataset):
    original = run_experiment(dataset)
    changed = replace(
        dataset,
        logs=[
            replace(g, points=999, rebounds=200, assists=100, minutes=48)
            if season_start(g.date) == 2025
            else g
            for g in dataset.logs
        ],
    )
    result = run_experiment(changed)
    assert result.selected == original.selected
    assert result.tuning_scores == original.tuning_scores
    assert result.holdout_scores != original.holdout_scores


def test_methods_use_identical_holdout_games(dataset):
    result = run_experiment(dataset)
    assert {r["evaluated_games"] for r in result.holdout_scores} == {59}
    assert {r["evaluated_games"] for r in result.minutes_scores} == {59}
    assert len(result.predictions) == 59 * 3 * 3
    grid = candidates()
    assert len(grid) == 18
    assert grid[0] == Candidate("previous_three", "fixed", 0)


def test_exact_ties_follow_documented_order():
    logs = [
        game(date(year, 10, 20) + timedelta(days=i), f"{year}-{i}")
        for year in (2022, 2023, 2024)
        for i in range(6)
    ]
    selected, _ = select_candidates(build_features(logs, "1"), (2023, 2024))
    assert set(selected.values()) == {Candidate("previous_three", "fixed", 0)}


def test_synthetic_source_never_fetches_nba_or_writes_cache(tmp_path, monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("Synthetic mode must not request NBA data")

    monkeypatch.setattr("bpps.baseline_research.NBAClient.logs", fail)
    first = load_history("1", 2022, 2025, source="synthetic", cache_dir=tmp_path)
    second = load_history("1", 2022, 2025, source="synthetic", cache_dir=tmp_path)
    assert first == second
    assert not list(tmp_path.iterdir())


def test_duplicate_player_game_rejected():
    log = game(date(2023, 1, 1), "a")
    with pytest.raises(ValueError, match="Duplicate"):
        validate_logs([log, log], "1")


def test_missing_periods_and_invalid_order(dataset):
    with pytest.raises(ValueError, match="precede"):
        run_experiment(dataset, (2025,), 2024)
    with pytest.raises(ValueError, match="tuning games"):
        run_experiment(dataset, (2021,), 2025)
    with pytest.raises(ValueError, match="holdout games"):
        run_experiment(dataset, (2023, 2024), 2026)


def test_source_validation(tmp_path):
    with pytest.raises(ValueError, match="csv_path"):
        load_history(source="csv")
    with pytest.raises(ValueError, match="ordered"):
        load_history(start=2025, end=2023)
    path = tmp_path / "history.csv"
    records = [game(date(2023, 10, 20), "a"), game(date(2024, 10, 20), "b")]
    with path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(asdict(records[0])))
        writer.writeheader()
        writer.writerows(asdict(g) for g in records)
    data = load_history(
        "1",
        2023,
        2023,
        source="csv",
        csv_path=path,
    )
    assert data.logs == records[:1]


def test_complete_nba_snapshot_reused(tmp_path, monkeypatch):
    calls = []

    def logs(self, player_id, season, season_type):
        calls.append((player_id, season, season_type))
        return [game(date(int(season[:4]), 10, 20), season)]

    monkeypatch.setattr("bpps.baseline_research.NBAClient.logs", logs)
    first = load_history("1", 2023, 2024, cache_dir=tmp_path)
    second = load_history("1", 2023, 2024, cache_dir=tmp_path)
    assert first == second
    assert len(calls) == 2
    assert first.summary()[0]["appearances"] == 1
    snapshot = next(tmp_path.glob("history-*.csv"))
    snapshot.write_text(snapshot.read_text().replace(",10,", ",11,"))
    load_history("1", 2023, 2024, cache_dir=tmp_path)
    assert len(calls) == 4


def test_incomplete_nba_download_does_not_save_snapshot(tmp_path, monkeypatch):
    def logs(self, player_id, season, season_type):
        if season == "2024-25":
            raise ValueError("blocked")
        return [game(date(2023, 10, 20), "a")]

    monkeypatch.setattr("bpps.baseline_research.NBAClient.logs", logs)
    with pytest.raises(ValueError, match="Incomplete NBA download at 2024-25"):
        load_history("1", 2023, 2024, cache_dir=tmp_path)
    assert not list(tmp_path.glob("history-*"))


def test_empty_nba_season_is_reported(tmp_path, monkeypatch):
    def logs(self, player_id, season, season_type):
        return [] if season == "2024-25" else [game(date(2023, 10, 20), "a")]

    monkeypatch.setattr("bpps.baseline_research.NBAClient.logs", logs)
    data = load_history("1", 2023, 2024, cache_dir=tmp_path)
    assert data.summary()[1] == {
        "season": "2024-25",
        "appearances": 0,
        "positive_minutes": 0,
    }


def test_saved_results_identify_data_and_periods(dataset, tmp_path):
    experiment = run_experiment(dataset)
    output = save_results(dataset, experiment, tmp_path)
    saved = json.loads((output / "results.json").read_text())
    assert saved["source"] == "synthetic"
    assert saved["dataset_sha256"] == dataset.sha256
    assert saved["tuning_seasons"] == [2023, 2024]
    assert saved["holdout_season"] == 2025
    assert saved["selected"]["points"] == {
        "window": experiment.selected["points"].window,
        "kind": experiment.selected["points"].kind,
        "value": experiment.selected["points"].value,
    }
    assert (output / "holdout_predictions.csv").exists()
