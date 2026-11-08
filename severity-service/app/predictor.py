import importlib.util
from pathlib import Path

from .config import Settings


def _load_bundle_class(model_dir: Path):
    """Load SeverityModel from the model bundle itself, so the bundle stays the single source of truth."""
    spec = importlib.util.spec_from_file_location("severity_predictor", model_dir / "severity_predictor.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SeverityModel


class SeverityPredictor:
    """Loads the encoder and CatBoost model once and scores complaint descriptions."""

    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.model = _load_bundle_class(cfg.model_dir)(str(cfg.model_dir))
        self.labels: list[str] = self.model.labels

    def predict(self, descriptions: list[str]) -> list[dict]:
        out = []
        for r in self.model.predict(descriptions):
            r["needs_review"] = r["confidence"] < self.cfg.review_threshold
            out.append(r)
        return out
