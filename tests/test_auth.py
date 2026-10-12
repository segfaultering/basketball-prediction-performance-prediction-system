"""Real signed JWT verification and authentication boundaries without NBA calls."""

import time
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jwt.exceptions import PyJWKClientConnectionError
from pydantic import ValidationError

from bpps.api import create_app
from bpps.auth import TokenVerifier
from bpps.settings import Settings
from bpps.supabase_store import ForecastStorageError, SupabaseForecastStore

URL = "https://project.supabase.co"


@pytest.fixture
def signing(monkeypatch):
    private = ec.generate_private_key(ec.SECP256R1())
    verifier = TokenVerifier(URL)
    monkeypatch.setattr(
        verifier.keys,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=private.public_key()),
    )
    owner = str(uuid4())

    def token(**overrides):
        claims = {
            "sub": owner,
            "iss": f"{URL}/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
            **overrides,
        }
        return jwt.encode(claims, private, algorithm="ES256", headers={"kid": "test"})

    return verifier, owner, token


def test_valid_signature_and_subject(signing):
    verifier, owner, token = signing
    assert verifier.verify(token()).id == owner


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": 1},
        {"iat": int(time.time()) + 3600},
        {"iss": "https://other.supabase.co/auth/v1"},
        {"aud": "anon"},
        {"role": "service_role"},
        {"sub": "not-a-uuid"},
        {"is_anonymous": True},
    ],
)
def test_invalid_claims_rejected(signing, overrides):
    verifier, _, token = signing
    with pytest.raises(HTTPException) as exc:
        verifier.verify(token(**overrides))
    assert exc.value.status_code == 401


def test_forged_and_unsigned_tokens_rejected(signing):
    verifier, _, token = signing
    forged = jwt.encode(
        jwt.decode(token(), options={"verify_signature": False}),
        ec.generate_private_key(ec.SECP256R1()),
        algorithm="ES256",
    )
    for invalid in (
        forged,
        "invalid",
        jwt.encode({"sub": "1"}, "s" * 32, algorithm="HS256"),
    ):
        with pytest.raises(HTTPException) as exc:
            verifier.verify(invalid)
        assert exc.value.status_code == 401


def test_key_service_failure_is_retryable(signing, monkeypatch):
    verifier, _, token = signing

    def unavailable(token):
        raise PyJWKClientConnectionError("internal url")

    monkeypatch.setattr(verifier.keys, "get_signing_key_from_jwt", unavailable)
    with pytest.raises(HTTPException) as exc:
        verifier.verify(token())
    assert exc.value.status_code == 503
    assert "internal url" not in exc.value.detail


@pytest.fixture
def authenticated_app(tmp_path, signing):
    app = create_app(
        Settings(
            _env_file=None,
            proj_dir=tmp_path,
            auth_enabled=1,
            supabase_url=URL,
            supabase_service_role_key="backend-secret",
            stub_mode=0,
            debug=0,
            public_demo=1,
            cors_origins=["https://courtside.example"],
        ),
        include_ui=False,
    )
    app.state.token_verifier = signing[0]
    return app


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/games", None),
        ("GET", "/teams/1/players?season=2025-26", None),
        ("POST", "/predictions", {"player_id": "1", "game_id": "1"}),
        ("POST", "/predictions/scenarios", {"player_id": "1", "game_id": "1"}),
        ("POST", "/backtests", {"player_id": "1"}),
        ("GET", "/forecasts", None),
        ("POST", "/forecasts/refresh", None),
    ],
)
def test_all_live_routes_require_auth(authenticated_app, method, path, body):
    with TestClient(authenticated_app) as client:
        response = client.request(method, path, json=body)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 200


def test_scoped_history_and_prediction(authenticated_app, signing, monkeypatch):
    owners = []
    monkeypatch.setattr(
        SupabaseForecastStore,
        "report",
        lambda self, limit, offset: {"owner": self.user_id},
    )

    def predict(body, store):
        owners.append(store.user_id)
        return {"forecast_id": "saved"}

    monkeypatch.setattr(authenticated_app.state.service, "prediction", predict)
    with TestClient(authenticated_app) as client:
        for owner in (signing[1], str(uuid4())):
            headers = {"Authorization": f"Bearer {signing[2](sub=owner)}"}
            assert client.get("/forecasts", headers=headers).json()["owner"] == owner
            assert (
                client.post(
                    "/predictions",
                    headers=headers,
                    json={"player_id": "1", "game_id": "1"},
                ).status_code
                == 200
            )
        assert owners == [signing[1], owner]
        assert (
            client.post(
                "/backtests", headers=headers, json={"player_id": "1"}
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/predictions",
                headers=headers,
                json={"player_id": "1", "game_id": "1", "owner_id": str(uuid4())},
            ).status_code
            == 422
        )
    assert authenticated_app.state.service.forecast_store is None
    assert not authenticated_app.state.settings.forecast_db.exists()


def test_storage_failure_does_not_report_saved_forecast(
    authenticated_app, signing, monkeypatch
):
    def fail(body, store):
        raise ForecastStorageError("backend-secret")

    monkeypatch.setattr(authenticated_app.state.service, "prediction", fail)
    with TestClient(authenticated_app) as client:
        response = client.post(
            "/predictions",
            headers={"Authorization": f"Bearer {signing[2]()}"},
            json={"player_id": "1", "game_id": "1"},
        )
    assert response.status_code == 503
    assert "backend-secret" not in response.text


def test_authorization_cors_preflight(authenticated_app):
    with TestClient(authenticated_app) as client:
        response = client.options(
            "/predictions",
            headers={
                "Origin": "https://courtside.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"supabase_url": "http://project.supabase.co"},
        {"supabase_url": "https://user:password@project.supabase.co"},
        {"supabase_url": "https://project.supabase.co/path"},
        {"supabase_service_role_key": ""},
        {"debug": 1},
    ],
)
def test_auth_settings_fail_closed(changes):
    values = {
        "supabase_url": URL,
        "supabase_service_role_key": "secret",
        "debug": 0,
        **changes,
    }
    with pytest.raises(ValidationError):
        Settings.model_validate({"auth_enabled": 1, **values})
