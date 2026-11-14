from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SEVERITY_")

    # Folder with severity_catboost.cbm, label_map.json and severity_predictor.py
    model_dir: Path = BASE_DIR / "model"
    model_version: str = "catboost_desc_only-cv5-2026-11-08"

    # needs_review is set when the returned severity's probability is below this.
    review_threshold: float = 0.6
    max_batch_size: int = 256

    # When set, /severity and /severity/batch require this value in an X-API-Key header.
    # Unset = open (fine on an internal network; set it on anything public).
    api_key: str | None = None


settings = Settings()
