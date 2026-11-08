"""Severity predictor: complaint description -> Low / Medium / High / Critical.

Sentence-transformer embeddings + a CatBoost classifier. Self-contained: it needs only
this file, `severity_catboost.cbm` and `label_map.json` in the same folder, plus
`pip install catboost sentence-transformers`.

    from severity_predictor import SeverityModel
    model = SeverityModel(".")                       # folder holding the .cbm and label_map.json
    model.predict(["Open manhole near the school, children could fall in"])
    # [{'severity': 'Critical', 'severity_id': 3, 'confidence': 0.81, 'probabilities': {...}}]
"""
import html
import json
import re
from pathlib import Path

import numpy as np
from catboost import CatBoostClassifier


def text_for_model(raw: str) -> str:
    """Same cleaning that was applied to the training text."""
    if not isinstance(raw, str):
        return ""
    s = html.unescape(html.unescape(raw))
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("​", " ").replace("﻿", " ")
    s = re.sub(r"[\r\n\t]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .,;:-}{").strip()
    s = s.split("@", 1)[0] if "@" in s else s
    s = re.sub(r"\b\d{4}-[0-9A-Z]{6}\b", " ", s)
    s = re.sub(r"\+?\d[\d\s-]{8,}\d", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class SeverityModel:
    def __init__(self, model_dir: str = ".", device: str | None = None):
        d = Path(model_dir)
        meta = json.loads((d / "label_map.json").read_text("utf-8"))
        self.labels: list[str] = meta["labels"]
        self.clf = CatBoostClassifier()
        self.clf.load_model(str(d / "severity_catboost.cbm"))
        if len(self.labels) != len(self.clf.classes_):
            raise RuntimeError("label_map.json does not match the model's classes")
        from sentence_transformers import SentenceTransformer

        self.encoder = SentenceTransformer(meta["embedding_model"], device=device)
        self.encoder.max_seq_length = meta.get("max_seq_length", 128)

    def predict_proba(self, texts: list[str]) -> np.ndarray:
        emb = self.encoder.encode([text_for_model(t) for t in texts], normalize_embeddings=True, batch_size=64)
        return self.clf.predict_proba(np.asarray(emb, dtype=np.float32))

    def predict(self, texts: list[str]) -> list[dict]:
        """One dict per input text: severity, severity_id, confidence and all class probabilities."""
        out = []
        for p in self.predict_proba(texts):
            k = int(np.argmax(p))
            out.append({
                "severity": self.labels[k],
                "severity_id": k,
                "confidence": round(float(p[k]), 4),
                "probabilities": {l: round(float(x), 4) for l, x in zip(self.labels, p)},
            })
        return out


if __name__ == "__main__":
    import sys

    m = SeverityModel(Path(__file__).resolve().parent)
    for t, r in zip(sys.argv[1:], m.predict(sys.argv[1:])):
        print(f"{r['severity']:9s} {r['confidence']:.2f}  {t}")
