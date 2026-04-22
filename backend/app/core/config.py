from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "MobiFlow ETL"
    environment: str = "local"
    api_prefix: str = "/api"
    metadata_database_url: str
    log_path: Path = Path("logs/app.log")
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.10.0.10:5173",
    ]

    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_prefix="MOBIFLOW_")


@lru_cache
def get_settings() -> Settings:
    return Settings()
