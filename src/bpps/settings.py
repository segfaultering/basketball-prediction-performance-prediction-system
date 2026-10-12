"""Validated configuration shared by the HTTP server and CLI."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    proj_dir: Path = PROJECT_ROOT
    stub_mode: Literal[0, 1] = 0
    debug: Literal[0, 1] = 0
    public_demo: Literal[0, 1] = 0
    cors_origins: list[str] = Field(default_factory=list)
    model_backend: str = "ridge"
    auth_enabled: Literal[0, 1] = 0
    supabase_url: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    frontend_dir: Path | None = None

    @field_validator("stub_mode", "debug", "public_demo", "auth_enabled", mode="before")
    @classmethod
    def parse_switch(cls, value, info):
        if isinstance(value, str) and value.strip() in {"0", "1"}:
            return int(value.strip())
        if type(value) is int and value in (0, 1):
            return value
        raise ValueError(f"{info.field_name.upper()} must be 0 or 1")

    @model_validator(mode="after")
    def validate_public_demo(self):
        if self.auth_enabled:
            parsed = urlsplit(self.supabase_url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path not in ("", "/")
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("AUTH_ENABLED requires an HTTPS SUPABASE_URL origin")
            self.supabase_url = self.supabase_url.rstrip("/")
            if not self.supabase_service_role_key.get_secret_value():
                raise ValueError("AUTH_ENABLED requires SUPABASE_SERVICE_ROLE_KEY")
            if self.debug:
                raise ValueError("AUTH_ENABLED requires DEBUG=0")
        if self.public_demo and (self.debug or self.stub_mode):
            raise ValueError("PUBLIC_DEMO requires DEBUG=0 and STUB_MODE=0")
        for origin in self.cors_origins:
            parsed = urlsplit(origin)
            if (
                not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or not (
                    parsed.scheme == "https"
                    or (
                        parsed.scheme == "http"
                        and parsed.hostname in {"localhost", "127.0.0.1"}
                    )
                )
            ):
                raise ValueError(
                    "CORS_ORIGINS must contain explicit HTTPS origins (or local development origins), without trailing slashes"
                )
        return self

    @property
    def cache_dir(self) -> Path:
        return self.proj_dir / ".cache" / "bpps"

    @property
    def forecast_db(self) -> Path:
        return self.proj_dir / "data" / "bpps" / "forecasts.sqlite3"
