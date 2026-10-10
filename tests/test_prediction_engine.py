"""Production training, fallback, persistence and leakage tests."""

import json
from dataclasses import replace
from datetime import date, timedelta

import pytest

from bpps.baseline import Candidate, make_context
from bpps.learning import LinearCorrection, RidgeBackend, create_backend
from bpps.model import GameLog
from bpps.prediction_engine import PredictionEngine, partitions, training_rows


@pytest.fixture
def logs():
    return [
        GameLog(
            "1",
            str(i),
            date(2023, 10, 20) + timedelta(days=i * 2),
            "GSW",
            "BOS",
            i % 2 == 0,
            30,
            20 if i % 2 == 0 else 10,
            5,
            8 if i % 2 == 0 else 4,
            1,
            0,
        )
        for i in range(90)
    ]


def test_ridge_learns_context_and_gates_each_stat(logs, tmp_path):
    engine = PredictionEngine(tmp_path)
    artifact = engine.train(logs, "1", date(2024, 5, 1))
    assert artifact["status"] == "trained"
    assert artifact["stats"]["points"]["active"] is True
    assert artifact["stats"]["assists"]["active"] is True
    assert artifact["stats"]["rebounds"]["active"] is False
    for stat in ("points", "assists"):
        entry = artifact["stats"][stat]
        assert entry["model_mae"] < entry["baseline_mae"]
    evaluation = artifact["evaluation"]
    assert evaluation["training_through"] < evaluation["tuning_through"]
    assert evaluation["tuning_through"] < evaluation["validation_start"]
    assert evaluation["validation_through"] == artifact["trained_through"]


def test_cached_model_reused_without_fitting(logs, tmp_path, monkeypatch):
    engine = PredictionEngine(tmp_path)
    artifact = engine.train(logs, "1", date(2024, 5, 1))

    def forbidden(*args, **kwargs):
        pytest.fail("An unchanged history must reuse the saved model")

    monkeypatch.setattr(engine.backend, "fit", forbidden)
    reused = engine.train(logs, "1", date(2024, 5, 1))
    assert reused["cache_hit"] is True
    assert reused["stats"] == artifact["stats"]


def test_changed_history_retrains(logs, tmp_path):
    engine = PredictionEngine(tmp_path)
    old = engine.train(logs[:-1], "1", date(2024, 5, 1))
    new = engine.train(logs, "1", date(2024, 5, 1))
    assert old["history_sha256"] != new["history_sha256"]
    assert new["cache_hit"] is False
    assert len(list(tmp_path.glob("*.json"))) == 2


@pytest.mark.parametrize(
    "corruption", ["not json", "[]", "invalid_features", "nan_coefficients"]
)
def test_corrupt_and_incompatible_artifacts_retrain(logs, tmp_path, corruption):
    engine = PredictionEngine(tmp_path)
    engine.train(logs, "1", date(2024, 5, 1))
    path = next(tmp_path.glob("*.json"))
    if corruption in ("not json", "[]"):
        path.write_text(corruption)
    else:
        data = json.loads(path.read_text())
        if corruption == "invalid_features":
            data["features"] = ["actual_target_minutes"]
        else:
            data["stats"]["points"]["model"]["coefficients"][0] = float("nan")
        path.write_text(json.dumps(data))
    rebuilt = engine.train(logs, "1", date(2024, 5, 1))
    assert rebuilt["cache_hit"] is False
    assert rebuilt["stats"]["points"]["active"] is True


def test_sources_and_season_types_do_not_share_artifacts(logs, tmp_path):
    live = PredictionEngine(tmp_path, source="nba")
    stub = PredictionEngine(tmp_path, source="stub")
    playoffs = PredictionEngine(tmp_path, source="nba", season_type="Playoffs")
    for engine in (live, stub, playoffs):
        assert engine.train(logs, "1", date(2024, 5, 1))["cache_hit"] is False
    assert len(list(tmp_path.glob("*.json"))) == 3


def test_prediction_scales_with_minutes_and_reports_baseline(logs, tmp_path):
    engine = PredictionEngine(tmp_path)
    one = engine.prediction(logs, "1", date(2024, 5, 1), "BOS", True, 15)
    two = engine.prediction(logs, "1", date(2024, 5, 1), "BOS", True, 30)
    zero = engine.prediction(logs, "1", date(2024, 5, 1), "BOS", True, 0)
    assert set(one["stats"]) == {"points", "rebounds", "assists", "steals", "blocks"}
    for stat in ("points", "rebounds", "assists"):
        assert two["stats"][stat]["prediction"] == pytest.approx(
            2 * one["stats"][stat]["prediction"], abs=0.02
        )
        assert (
            one["stats"][stat]["baseline_prediction"] == one["baseline"]["stats"][stat]
        )
        assert zero["stats"][stat]["prediction"] == 0
        assert zero["stats"][stat]["approximate_80pct_range"] == [0, 0]
    assert two["model"]["cache_hit"] is True


def test_short_history_uses_blend_without_training(logs, tmp_path, monkeypatch):
    engine = PredictionEngine(tmp_path)

    def forbidden(*args, **kwargs):
        pytest.fail("Short history must not train an unvalidated model")

    monkeypatch.setattr(engine.backend, "fit", forbidden)
    result = engine.prediction(logs[:10], "1", date(2023, 11, 10), "BOS", True)
    assert result["model"]["status"] == "insufficient_history"
    for stat in ("points", "rebounds", "assists"):
        assert result["stats"][stat]["prediction"] == result["baseline"]["stats"][stat]


def test_future_and_same_date_games_cannot_change_predictions(logs):
    target = logs[65].date
    engine = PredictionEngine(None)
    original = engine.prediction(logs, "1", target, "BOS", True)
    changed = [
        replace(g, points=999, assists=999, rebounds=999, minutes=48)
        if g.date >= target
        else g
        for g in logs
    ]
    assert engine.prediction(changed, "1", target, "BOS", True) == original
    assert original["model"]["trained_through"] < target.isoformat()


def test_validation_labels_do_not_select_weights_or_alpha(logs):
    engine = PredictionEngine(None)
    original = engine.train(logs, "1", date(2024, 5, 1))
    start = date.fromisoformat(original["evaluation"]["validation_start"])
    changed = [
        replace(g, points=999, assists=999) if g.date >= start else g for g in logs
    ]
    updated = engine.train(changed, "1", date(2024, 5, 1))
    for stat in ("points", "rebounds", "assists"):
        assert updated["stats"][stat]["baseline"] == original["stats"][stat]["baseline"]
        assert (
            updated["stats"][stat]["parameter"] == original["stats"][stat]["parameter"]
        )


def test_actual_target_minutes_are_not_features(logs):
    target = logs[60]
    a = next(r for r in training_rows(logs) if r.game.game_id == target.game_id)
    changed = [
        replace(g, minutes=48) if g.game_id == target.game_id else g for g in logs
    ]
    b = next(r for r in training_rows(changed) if r.game.game_id == target.game_id)
    candidate = Candidate("previous_three", "adaptive", 600)
    assert a.context.vector("points", candidate) == b.context.vector(
        "points", candidate
    )


def test_partitions_never_split_a_date(logs):
    duplicate_date = replace(logs[60], game_id="second-game")
    rows = training_rows(
        sorted(logs + [duplicate_date], key=lambda g: (g.date, g.game_id))
    )
    split = partitions(rows)
    assert split is not None
    train, tuning, validation = split
    assert max(r.game.date for r in train) < min(r.game.date for r in tuning)
    assert max(r.game.date for r in tuning) < min(r.game.date for r in validation)


class BadBackend:
    identity = "bad-test-backend"
    parameters = (1.0,)

    def fit(self, features, targets, minutes, parameter):
        return LinearCorrection([0.0] * len(features[0]), 1000)

    def restore(self, payload, feature_count):
        return LinearCorrection(payload["coefficients"], payload["intercept"])


def test_backend_can_be_swapped_and_bad_corrections_are_rejected(logs, tmp_path):
    engine = PredictionEngine(tmp_path, backend=BadBackend())
    result = engine.prediction(logs, "1", date(2024, 5, 1), "BOS", True)
    assert result["model"]["backend"] == "bad-test-backend"
    for stat in ("points", "rebounds", "assists"):
        assert result["model"]["stats"][stat]["active"] is False
        assert result["stats"][stat]["prediction"] == result["baseline"]["stats"][stat]


def test_ridge_json_roundtrip_and_unknown_backend():
    backend = RidgeBackend()
    model = backend.fit(
        [[0.0], [1.0], [2.0], [3.0]], [0.0, 2.0, 4.0, 6.0], [30] * 4, 1.0
    )
    restored = backend.restore(json.loads(json.dumps(model.payload())), 1)
    assert restored.predict([1.5]) == pytest.approx(3.0)
    with pytest.raises(ValueError, match="artifact"):
        backend.restore({"coefficients": [1, 2], "intercept": 0}, 1)
    with pytest.raises(ValueError, match="backend"):
        create_backend("unknown")


def test_duplicates_and_invalid_minutes_rejected(logs):
    engine = PredictionEngine(None)
    with pytest.raises(ValueError, match="Duplicate"):
        engine.train(logs + [logs[0]], "1", date(2024, 5, 1))
    for minutes in (-1, 49, float("nan")):
        with pytest.raises(ValueError, match="minutes"):
            engine.prediction(logs, "1", date(2024, 5, 1), "BOS", True, minutes)


def test_core_context_uses_rate_totals_and_separate_seasons():
    logs = [
        GameLog(
            "1",
            str(i),
            date(2023, 1, 1) + timedelta(days=i),
            "GSW",
            "BOS",
            True,
            20,
            10,
            4,
            3,
            1,
            0,
        )
        for i in range(5)
    ]
    logs.append(
        replace(
            logs[0], game_id="current", date=date(2023, 10, 20), minutes=40, points=40
        )
    )
    context = make_context(logs, date(2023, 10, 22), True)
    assert context.career_rates is not None and context.season_rates is not None
    assert context.career_rates["points"] == 0.5
    assert context.season_rates["points"] == 1
    assert Candidate("career", "fixed", 0.75).estimate(
        context, "points"
    ) == pytest.approx(0.875 * 140 / 6)


def test_backtest_uses_earlier_history_and_reports_baseline(logs):
    result = PredictionEngine(None).backtest(logs[:12], "1")
    assert result["evaluated_games"] == 7
    assert "earlier dates" in result["method"]
    for stat in ("points", "rebounds", "assists"):
        assert (
            result["stats"][stat]["mae"]
            == result["stats"][stat]["blended_baseline_mae"]
        )


def test_backtest_matches_individual_pregame_predictions(logs):
    history = logs[:58]
    engine = PredictionEngine(None)
    result = engine.backtest(history, "1")
    errors = []
    for target in history[5:]:
        prediction = engine.prediction(
            history, "1", target.date, target.opponent, target.home
        )
        errors.append(abs(prediction["stats"]["points"]["prediction"] - target.points))
    assert result["stats"]["points"]["mae"] == round(sum(errors) / len(errors), 3)


def test_cli_auto_training_and_prediction(tmp_path, monkeypatch, capsys):
    from bpps.cli import main
    from bpps.settings import Settings

    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STUB_MODE", "1")
    monkeypatch.setenv("PROJ_DIR", str(tmp_path))
    monkeypatch.setenv("MODEL_BACKEND", "ridge")
    monkeypatch.setattr("sys.argv", ["bpps", "train", "--player-id", "demo-player"])
    assert main() == 0
    training = json.loads(capsys.readouterr().out)
    assert training["source"] == "stub"
    assert training["status"] == "trained"
    monkeypatch.setattr(
        "sys.argv",
        [
            "bpps",
            "predict",
            "--player-id",
            "demo-player",
            "--game-id",
            "demo-game",
            "--team",
            "LAL",
        ],
    )
    assert main() == 0
    prediction = json.loads(capsys.readouterr().out)
    assert prediction["model"]["cache_hit"] is True
    assert "baseline" in prediction
    assert prediction["forecast_id"]
    monkeypatch.setattr("sys.argv", ["bpps", "forecasts", "--refresh-results"])
    assert main() == 0
    history = json.loads(capsys.readouterr().out)
    assert history["total"] == 1
    assert history["forecasts"][0]["prediction"]["stats"] == prediction["stats"]
    assert history["refresh"]["updated_forecasts"] == 0
