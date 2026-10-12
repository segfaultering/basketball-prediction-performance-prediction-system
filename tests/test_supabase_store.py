"""Exercise Supabase requests and reuse forecast metrics without a live database."""

from datetime import date
from uuid import uuid4

import httpx
import pytest

from bpps.model import GameLog
from bpps.supabase_store import ForecastStorageError, SupabaseForecastStore


@pytest.fixture
def store():
    return SupabaseForecastStore(
        "https://project.supabase.co", "server-key", "nba", str(uuid4())
    )


def mock_http(monkeypatch, handler):
    client = httpx.Client
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "bpps.supabase_store.httpx.Client",
        lambda **kwargs: client(transport=transport, **kwargs),
    )


def test_save_owner_is_server_selected(store, monkeypatch):
    import json

    calls = []

    def handler(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert payload["owner_id"] == store.user_id
        assert payload["source"] == "nba"
        assert request.headers["apikey"] == "server-key"
        return httpx.Response(201)

    mock_http(monkeypatch, handler)
    result = store.save({"player_id": "1"}, {"player_id": "1"})
    assert result["forecast_id"]
    assert result["saved_at"]
    assert len(calls) == 1


def test_reads_page_without_losing_history_and_always_scope_owner(store, monkeypatch):
    offsets = []

    def handler(request):
        assert request.url.params["owner_id"] == f"eq.{store.user_id}"
        assert request.url.params["source"] == "eq.nba"
        offset = int(request.url.params["offset"])
        offsets.append(offset)
        count = 100 if offset == 0 else 1
        return httpx.Response(200, json=[{"id": str(offset + i)} for i in range(count)])

    mock_http(monkeypatch, handler)
    assert len(store.records()) == 101
    assert offsets == [0, 100]


def test_updates_only_scoped_outcomes(store, monkeypatch):
    import json

    identifier = str(uuid4())

    def handler(request):
        assert request.method == "PATCH"
        assert request.url.params["owner_id"] == f"eq.{store.user_id}"
        assert request.url.params["source"] == "eq.nba"
        assert request.url.params["id"] == f"in.({identifier})"
        payload = json.loads(request.content)
        assert set(payload) == {"outcome", "updated_at"}
        assert payload["outcome"]["stats"]["points"] == 22
        return httpx.Response(204)

    mock_http(monkeypatch, handler)
    store.settle(
        [identifier],
        GameLog("1", "game", date(2026, 1, 1), "LAL", "BOS", True, 30, 22, 5, 6, 1, 0),
    )


@pytest.mark.parametrize("status", [401, 403, 500])
def test_storage_errors_are_not_reported_as_success(store, monkeypatch, status):
    mock_http(
        monkeypatch,
        lambda request: httpx.Response(
            status, json={"message": "private database detail"}
        ),
    )
    with pytest.raises(ForecastStorageError, match="Forecast storage is unavailable"):
        store.save({}, {})


def test_invalid_storage_json_is_unavailable(store, monkeypatch):
    mock_http(monkeypatch, lambda request: httpx.Response(200, text="not json"))
    with pytest.raises(ForecastStorageError):
        store.records()
