from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_API_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_API_ROOT / ".env"), extra="ignore")

    app_env: str = "dev"
    app_jwt_secret: str
    app_jwt_access_minutes: int = 1440  # 24 hours
    app_jwt_refresh_days: int = 30
    app_encryption_key: str
    app_cors_origins: str = "http://localhost:5173"
    app_frontend_base: str = "http://localhost:5173"
    app_timezone: str = "Asia/Bishkek"
    app_cookie_secure: bool | None = None
    app_cookie_samesite: str = "lax"

    supabase_url: str
    supabase_service_role_key: str

    zoom_client_id: str | None = None
    zoom_client_secret: str | None = None
    zoom_redirect_uri: str | None = None


settings = Settings()
