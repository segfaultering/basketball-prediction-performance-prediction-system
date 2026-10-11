"""The bundled portfolio demonstration is real, reproducible and retrospective."""

import hashlib
import json
from datetime import date

import pytest

from bpps.data import read_logs
from bpps.prediction_engine import PredictionEngine
from bpps.replay import build_snapshot
from bpps.settings import PROJECT_ROOT


def test_snapshot_identity_and_chronology():
    history_path = PROJECT_ROOT / "examples/replay/history.csv"
    manifest = json.loads((PROJECT_ROOT / "examples/replay/manifest.json").read_text())
    snapshot = json.loads(
        (PROJECT_ROOT / "frontend/public/replay/snapshot.json").read_text()
    )
    assert (
        hashlib.sha256(history_path.read_bytes()).hexdigest()
        == manifest["history_sha256"]
        == snapshot["history_sha256"]
    )
    assert len(snapshot["games"]) == 3
    assert len(snapshot["predictions"]) == 6
    assert snapshot["date"] == "2025-03-08"
    for entry in snapshot["predictions"].values():
        prediction = entry["default"]
        assert prediction["replay_mode"] is True
        assert prediction["stub_mode"] is False
        assert prediction["model"]["trained_through"] < snapshot["date"]
        assert prediction["last_history_date"] < snapshot["date"]
        assert "forecast_id" not in prediction
        assert len(entry["scenarios"]) == 49
        assert all(
            stat["prediction"] == 0
            for stat in entry["scenarios"]["0"]["stats"].values()
        )


def test_prepared_scenario_matches_real_engine_without_target_game(tmp_path):
    snapshot = json.loads(
        (PROJECT_ROOT / "frontend/public/replay/snapshot.json").read_text()
    )
    logs = read_logs(PROJECT_ROOT / "examples/replay/history.csv")
    player_id = "201939"
    prepared = snapshot["predictions"][player_id]
    target = date.fromisoformat(snapshot["date"])
    prediction = prepared["default"]
    before_game = [g for g in logs if g.date < target]
    result = PredictionEngine(tmp_path, source="replay").prediction(
        before_game, player_id, target, prediction["opponent"], prediction["home"], 32
    )
    assert result["stats"] == prepared["scenarios"]["32"]["stats"]
    assert result["baseline"] == prepared["scenarios"]["32"]["baseline"]


def test_builder_rejects_modified_history_before_training(tmp_path):
    history = tmp_path / "history.csv"
    history.write_text("tampered history")
    with pytest.raises(ValueError, match="provenance manifest"):
        build_snapshot(history, PROJECT_ROOT / "examples/replay/manifest.json")
