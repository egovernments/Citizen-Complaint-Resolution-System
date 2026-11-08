import json

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from sentence_transformers import SentenceTransformer

from .config import Settings
from .preprocess import text_for_model

EMBED_DIM = 384
FEATURES = [f"e{i}" for i in range(EMBED_DIM)] + ["ctype"]


class SeverityPredictor:
    """Loads the encoder and CatBoost model once and scores complaints."""

    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.labels: list[str] = json.loads(cfg.label_map_path.read_text("utf-8"))["labels"]

        self.model = CatBoostClassifier()
        self.model.load_model(str(cfg.model_path))
        if list(self.model.feature_names_) != FEATURES:
            raise RuntimeError("Model feature schema does not match e0..e383 + ctype")
        if len(self.labels) != len(self.model.classes_):
            raise RuntimeError("label_map.json does not match the model's classes")

        self.encoder = SentenceTransformer(cfg.encoder_path)
        self.encoder.max_seq_length = cfg.max_seq_length

    def predict(self, items: list[tuple[str, str | None]]) -> list[dict]:
        """items: (raw description, complaint type display name) pairs, one result each."""
        texts = [text_for_model(d) for d, _ in items]
        emb = self.encoder.encode(texts, normalize_embeddings=True, batch_size=32)
        X = pd.DataFrame(np.asarray(emb, dtype=float), columns=FEATURES[:-1])
        X["ctype"] = [c or self.cfg.default_ctype for _, c in items]
        proba = self.model.predict_proba(X)

        critical_id = len(self.labels) - 1
        out = []
        for p in proba:
            sev = int(np.argmax(p))
            if p[critical_id] >= self.cfg.critical_threshold:
                sev = critical_id
            confidence = float(p[sev])
            out.append(
                {
                    "severity_id": sev,
                    "severity": self.labels[sev],
                    "confidence": round(confidence, 4),
                    "probabilities": {l: round(float(x), 4) for l, x in zip(self.labels, p)},
                    "needs_review": confidence < self.cfg.review_threshold,
                }
            )
        return out
