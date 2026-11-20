from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SEVERITY_")

    model_path: Path = BASE_DIR / "model" / "catboost_pgr.cbm"
    label_map_path: Path = BASE_DIR / "model" / "label_map.json"
    ctype_values_path: Path = BASE_DIR / "model" / "ctype_values.json"
    # The Docker image points this at a local copy baked in at build time;
    # on a dev machine the hub name is resolved (and cached) on first run.
    encoder_path: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    max_seq_length: int = 128
    model_version: str = "catboost_pgr-2026-10-24"

    # Return "Critical" whenever P(Critical) >= this, even if it is not the argmax.
    critical_threshold: float = 0.5
    # needs_review is set when the returned severity's probability is below this.
    review_threshold: float = 0.6
    default_ctype: str = "Others"
    max_batch_size: int = 256

    # When set, /severity and /severity/batch require this value in an X-API-Key header.
    # Unset = open (fine on an internal network; set it on anything public).
    api_key: str | None = None


settings = Settings()
