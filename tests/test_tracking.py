"""Prospective forecast persistence, matching, and unbiased summaries."""

from copy import deepcopy
from datetime import UTC, date, datetime

import pytest

from bpps.model import STATS, GameLog
from bpps.providers import NBAClient, StubClient
from bpps.tracking import ForecastStore, require_pregame


def prediction(player="1", game="game-1", value=20):
    return {
        "player_id": player,
        "game_id": game,
        "game_date": "2026-01-03",
        "team": "LAL",
        "opponent": "BOS",
        "stats": {
            stat: {"prediction": value, "approximate_80pct_range": [18, 24]}
            for stat in STATS
        },
        "baseline": {"stats": {stat: 18 for stat in STATS}},
        "model": {"history_sha256": "original-history", "backend": "ridge-v1"},
    }


def save(store, player="1", game="game-1", value=20):
    return store.save(
        {"season_type": "Regular Season", "minutes": None, "seasons": None},
        prediction(player, game, value),
    )["forecast_id"]


def actual(player="1", game="game-1", value=22, minutes=30, day=date(2026, 1, 3)):
    return GameLog(player, game, day, "LAL", "BOS", True, minutes, *([value] * 5))


@pytest.fixture
def store(tmp_path):
    return ForecastStore(tmp_path / "data" / "forecasts.sqlite3", "stub")


def test_persistent_immutable_snapshots_and_mode_isolation(store):
    original = prediction()
    inputs = {"season_type": "Regular Season", "minutes": 32}
    saved = store.save(inputs, original)
    snapshot = deepcopy(original)
    original["stats"]["points"]["prediction"] = 999
    inputs["minutes"] = 1
    reopened = ForecastStore(store.path, "stub")
    record = reopened.records()[0]
    assert record["id"] == saved["forecast_id"]
    assert record["prediction"] == snapshot
    assert record["inputs"]["minutes"] == 32
    assert datetime.fromisoformat(record["created_at"]).tzinfo is not None
    assert ForecastStore(store.path, "nba").report()["total"] == 0
    assert reopened.report()["summary"]["stats"]["points"]["mae"] is None


def test_metrics_use_first_forecast_and_exclude_pending_and_dnp(store):
    first = save(store)
    scenario = save(store, value=999)
    second = save(store, game="game-2")
    dnp = save(store, game="game-3")
    save(store, game="game-4")
    store.settle([first, scenario], actual())
    store.settle([second], actual(game="game-2", value=28))
    store.settle([dnp], actual(game="game-3", value=0, minutes=0))
    report = store.report(limit=2)
    assert report["total"] == 5
    assert len(report["forecasts"]) == 2
    summary = report["summary"]
    assert summary["tracked_games"] == 4
    assert summary["evaluated_games"] == 2
    assert summary["pending_games"] == 1
    assert summary["did_not_play_games"] == 1
    assert summary["stats"]["points"] == {
        "mae": 5,
        "rmse": pytest.approx(34**0.5, abs=0.001),
        "baseline_mae": 7,
        "range_coverage": 0.5,
    }
    records = {r["id"]: r for r in store.report()["forecasts"]}
    assert records[first]["primary"] is True
    assert records[scenario]["primary"] is False
    assert records[first]["errors"]["points"] == -2
    assert records[dnp]["errors"] is None
    assert store.report(limit=2, offset=2)["forecasts"][0]["id"] == second


def test_refresh_requires_final_game_and_exact_matching(store, monkeypatch):
    saved = save(store)
    provider = StubClient()
    status = 2
    monkeypatch.setattr(
        provider,
        "schedule",
        lambda season=None: [
            {"game_id": "game-1", "date": "2026-01-03", "status": status}
        ],
    )
    monkeypatch.setattr(
        provider, "logs", lambda *args: [actual(game="wrong"), actual(player="wrong")]
    )
    assert store.refresh(provider)["updated_forecasts"] == 0
    status = 3
    assert store.refresh(provider)["updated_forecasts"] == 0
    assert store.report()["forecasts"][0]["status"] == "pending"
    monkeypatch.setattr(provider, "logs", lambda *args: [actual()])
    assert store.refresh(provider)["updated_forecasts"] == 1
    record = store.report()["forecasts"][0]
    assert record["id"] == saved
    assert record["status"] == "settled"
    assert record["prediction"]["stats"]["points"]["prediction"] == 20
    monkeypatch.setattr(provider, "logs", lambda *args: [actual(value=25)])
    assert store.refresh(provider)["updated_forecasts"] == 1
    assert store.report()["forecasts"][0]["outcome"]["stats"]["points"] == 25
    assert store.report()["summary"]["evaluated_games"] == 1


def test_nba_refresh_bypasses_cache_and_matches_ids_across_calendar_days(
    tmp_path, monkeypatch
):
    store = ForecastStore(tmp_path / "forecasts.sqlite3", "nba")
    save(store)
    calls = []

    def schedule(client, season):
        calls.append((client.refresh, season))
        return [{"game_id": "game-1", "date": "2026-01-03", "status": 3}]

    monkeypatch.setattr(NBAClient, "schedule", schedule)
    monkeypatch.setattr(NBAClient, "logs", lambda *args: [actual(day=date(2026, 1, 2))])
    client = NBAClient(tmp_path)
    assert store.refresh(client)["updated_forecasts"] == 1
    assert calls == [(True, "2025-26")]
    assert client.refresh is False
    assert store.report()["forecasts"][0]["outcome"]["date"] == "2026-01-02"


def test_partial_refresh_failure_preserves_records_and_other_results(
    store, monkeypatch
):
    first = save(store)
    save(store, player="2")
    provider = StubClient()
    monkeypatch.setattr(
        provider,
        "schedule",
        lambda season=None: [{"game_id": "game-1", "date": "2026-01-03", "status": 3}],
    )

    def logs(player, season, season_type):
        if player == "2":
            raise ValueError("Upstream timeout")
        return [actual()]

    monkeypatch.setattr(provider, "logs", logs)
    result = store.refresh(provider)
    assert result["updated_forecasts"] == 1
    assert result["errors"] == [
        {"player_id": "2", "season": "2025-26", "detail": "Upstream timeout"}
    ]
    records = {r["id"]: r for r in store.report()["forecasts"]}
    assert records[first]["status"] == "settled"
    assert store.report()["summary"]["pending_games"] == 1


@pytest.mark.parametrize(
    "tipoff",
    ["2026-01-03T01:00:00Z", "2026-01-03T01:00:00", "2026-01-02T20:00:00-05:00"],
)
def test_tipoff_guard_handles_utc_naive_and_offset_times(tipoff):
    game = {"status": 1, "date": "2026-01-03", "tipoff_utc": tipoff}
    require_pregame(game, datetime(2026, 1, 3, 0, 59, tzinfo=UTC))
    with pytest.raises(ValueError, match="tipoff has passed"):
        require_pregame(game, datetime(2026, 1, 3, 1, tzinfo=UTC))


def test_nba_outcome_type_is_independent_of_training_history(tmp_path, monkeypatch):
    store = ForecastStore(tmp_path / "forecasts.sqlite3", "nba")
    save(store)
    monkeypatch.setattr(
        NBAClient,
        "schedule",
        lambda *args: [{"game_id": "game-1", "date": "2026-01-03", "status": 3}],
    )
    fetched_types = []

    def logs(client, player, season, season_type):
        fetched_types.append(season_type)
        return [actual()] if season_type == "Playoffs" else []

    monkeypatch.setattr(NBAClient, "logs", logs)
    assert store.refresh(NBAClient(tmp_path))["updated_forecasts"] == 1
    assert fetched_types == ["Regular Season", "Playoffs"]
    assert store.report()["forecasts"][0]["inputs"]["season_type"] == "Regular Season"


def test_past_date_without_tipoff_is_rejected():
    with pytest.raises(ValueError, match="tipoff has passed"):
        require_pregame(
            {"status": 1, "date": "2026-01-02"}, datetime(2026, 1, 3, tzinfo=UTC)
        )


def test_refresh_counts_saved_outcomes_before_a_later_season_type_failure(
    tmp_path, monkeypatch
):
    store = ForecastStore(tmp_path / "forecasts.sqlite3", "nba")
    first = save(store)
    second = save(store, game="game-2")
    monkeypatch.setattr(
        NBAClient,
        "schedule",
        lambda *args: [
            {"game_id": game, "date": "2026-01-03", "status": 3}
            for game in ("game-1", "game-2")
        ],
    )

    def logs(client, player, season, season_type):
        if season_type == "Regular Season":
            return [actual()]
        raise ValueError("Playoff data unavailable")

    monkeypatch.setattr(NBAClient, "logs", logs)
    result = store.refresh(NBAClient(tmp_path))
    assert result["updated_forecasts"] == 1
    assert result["errors"][0]["detail"] == "Playoff data unavailable"
    records = {record["id"]: record for record in store.report()["forecasts"]}
    assert records[first]["status"] == "settled"
    assert records[second]["status"] == "pending"
