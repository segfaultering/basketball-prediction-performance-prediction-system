"""Validated configuration shared by the HTTP server and CLI."""

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
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
    model_backend: str = "ridge"
    gemini_api_key: SecretStr | None = None
    gemini_model: str = Field(default="gemini-3.1-flash-lite", min_length=1)
    research_timeout_seconds: int = Field(default=60, ge=5, le=120)

    @field_validator("stub_mode", "debug", mode="before")
    @classmethod
    def parse_switch(cls, value, info):
        if isinstance(value, str) and value.strip() in {"0", "1"}:
            return int(value.strip())
        if type(value) is int and value in (0, 1):
            return value
        raise ValueError(f"{info.field_name.upper()} must be 0 or 1")

    @property
    def cache_dir(self) -> Path:
        return self.proj_dir / ".cache" / "bpps"

    @property
    def forecast_db(self) -> Path:
        return self.proj_dir / "data" / "bpps" / "forecasts.sqlite3"
