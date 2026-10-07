from pathlib import Path

import pytest
from pydantic import ValidationError

from bpps.providers import NBAClient, StubClient, create_provider
from bpps.settings import PROJECT_ROOT, Settings


@pytest.fixture(autouse=True)
def clear_environment(monkeypatch):
    for key in ("STUB_MODE", "DEBUG", "PROJ_DIR"):
        monkeypatch.delenv(key, raising=False)


def test_dotenv_loads_from_configured_root(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(f"STUB_MODE=1\nDEBUG=1\nPROJ_DIR={tmp_path}\nUNRELATED=value\n")
    monkeypatch.setitem(Settings.model_config, "env_file", env_file)
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    monkeypatch.chdir(other_dir)
    config = Settings()
    assert config.stub_mode == 1
    assert config.debug == 1
    assert config.proj_dir == tmp_path
    assert isinstance(create_provider(settings=config), StubClient)
    from bpps.api import create_app

    app = create_app(config, include_ui=False)
    assert app.debug is True
    assert app.state.settings is config


def test_environment_overrides_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("STUB_MODE=1\nDEBUG=1\n")
    monkeypatch.setenv("STUB_MODE", "0")
    monkeypatch.setenv("DEBUG", "0")
    config = Settings(_env_file=env_file)
    assert config.stub_mode == 0
    assert config.debug == 0
    assert isinstance(create_provider(settings=config), NBAClient)


def test_missing_file_defaults(tmp_path):
    config = Settings(_env_file=tmp_path / "missing.env")
    assert config.stub_mode == 0
    assert config.debug == 0
    assert config.proj_dir == PROJECT_ROOT


def test_cache_dir_and_explicit_override(tmp_path):
    config = Settings(_env_file=None, proj_dir=tmp_path, stub_mode=0)
    provider = create_provider(settings=config)
    assert isinstance(provider, NBAClient)
    assert provider.cache_dir == tmp_path / ".cache" / "bpps"
    overridden = create_provider(cache_dir="override", settings=config)
    assert isinstance(overridden, NBAClient)
    assert overridden.cache_dir == Path("override")


@pytest.mark.parametrize("field", ["STUB_MODE", "DEBUG"])
@pytest.mark.parametrize("value", ["true", "false", "2", "", "no"])
def test_invalid_file_switches(tmp_path, field, value):
    env_file = tmp_path / ".env"
    env_file.write_text(f"{field}={value}\n")
    with pytest.raises(ValidationError, match=field):
        Settings(_env_file=env_file)
