from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "MobiFlow ETL"
    environment: str = "local"
    api_prefix: str = "/api"
    metadata_database_url: str
    log_path: Path = Path("logs/app.log")
    auth_token_ttl_hours: int = 12
    bootstrap_admin_email: str = "admin@mobiflow.local"
    bootstrap_admin_password: str | None = None
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.10.0.10:5173",
    ]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "10.10.0.10"]
    force_https: bool = False
    allow_raw_sql_sources: bool = False
    allow_custom_transforms: bool = False
    scheduler_lock_enabled: bool = True
    pii_encryption_key: str | None = None
    pii_encryption_keys: str | None = None

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"prod", "production"}

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.is_production:
            insecure_origins = {"*", "http://localhost:5173", "http://127.0.0.1:5173"}
            if any(origin in insecure_origins for origin in self.cors_origins):
                raise ValueError("Production CORS origins must be explicit HTTPS application origins")
            if "*" in self.allowed_hosts or not self.allowed_hosts:
                raise ValueError("Production allowed hosts must be explicit hostnames")
            if not self.force_https:
                raise ValueError("Production requires MOBIFLOW_FORCE_HTTPS=true")
            if not self.bootstrap_admin_password:
                raise ValueError("Production requires MOBIFLOW_BOOTSTRAP_ADMIN_PASSWORD to be set")
        return self

    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_prefix="MOBIFLOW_")


@lru_cache
def get_settings() -> Settings:
    return Settings()
