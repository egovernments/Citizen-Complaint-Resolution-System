"""Train a description-only severity model: sentence-transformer embeddings + CatBoost.

Input is the LLM-labelled file (complaint_id, description, label). The model sees only the
complaint description (no complaint type) and predicts Low / Medium / High / Critical.

    python training/train_description_only.py                  # full run
    python training/train_description_only.py --limit 3000 --iterations 60   # quick smoke test

Outputs go to model/description_only/ (the earlier model lives in older_severity_model/ and is not touched):
    catboost_desc_only.cbm, label_map.json, metrics.json, confusion_matrix.csv, test_predictions.csv
Embeddings are cached in training/cache/ so re-training does not re-encode.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, Pool
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, classification_report, cohen_kappa_score,
                             confusion_matrix, f1_score, log_loss, matthews_corrcoef)
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from severity_predictor import text_for_model  # same cleaning the predictor applies at prediction time  # noqa: E402

LABELS = ["Low", "Medium", "High", "Critical"]
ENCODER = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
FEATURES = [f"e{i}" for i in range(384)]


def embed(texts: list[str], cache_dir: Path, max_len: int, batch: int) -> np.ndarray:
    key = hashlib.sha1((ENCODER + str(max_len) + "\n".join(texts)).encode("utf-8")).hexdigest()[:16]
    cache = cache_dir / f"emb_{key}.npy"
    if cache.exists():
        print(f"loaded cached embeddings {cache.name}", flush=True)
        return np.load(cache)
    from sentence_transformers import SentenceTransformer

    enc = SentenceTransformer(ENCODER)
    enc.max_seq_length = max_len
    t0 = time.time()
    emb = enc.encode(texts, normalize_embeddings=True, batch_size=batch, show_progress_bar=True)
    print(f"encoded {len(texts)} texts in {time.time() - t0:.0f}s", flush=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    np.save(cache, emb.astype(np.float32))
    return emb.astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "labelling" / "output" / "llm_labels.csv"))
    ap.add_argument("--source", default="", help="cleaned dataset with the original labels (for a second comparison)")
    ap.add_argument("--out-dir", default=str(ROOT / "model" / "description_only"))
    ap.add_argument("--cache-dir", default=str(ROOT / "training" / "cache"))
    ap.add_argument("--iterations", type=int, default=2000)
    ap.add_argument("--learning-rate", type=float, default=0.08)
    ap.add_argument("--depth", type=int, default=6)
    ap.add_argument("--max-seq-length", type=int, default=128)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--limit", type=int, default=0, help="random subset of N rows (smoke test)")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()

    df = pd.read_csv(a.data)
    if a.limit:
        df = df.sample(a.limit, random_state=a.seed).reset_index(drop=True)
    df["text"] = df["description"].map(text_for_model)
    df = df[df["text"].str.len() > 0].reset_index(drop=True)
    df["y"] = df["label"].map({l: i for i, l in enumerate(LABELS)})
    assert df["y"].notna().all(), "unknown label values"
    y = df["y"].astype(int).to_numpy()
    print(f"{len(df)} rows; label counts: {df['label'].value_counts().reindex(LABELS).to_dict()}", flush=True)

    X = pd.DataFrame(embed(df["text"].tolist(), Path(a.cache_dir), a.max_seq_length, a.batch_size), columns=FEATURES)

    idx = np.arange(len(df))
    tr, rest = train_test_split(idx, test_size=0.2, stratify=y, random_state=a.seed)
    va, te = train_test_split(rest, test_size=0.5, stratify=y[rest], random_state=a.seed)
    print(f"split: train {len(tr)} / validation {len(va)} / test {len(te)}", flush=True)

    model = CatBoostClassifier(
        loss_function="MultiClass", iterations=a.iterations, learning_rate=a.learning_rate, depth=a.depth,
        l2_leaf_reg=3, auto_class_weights="SqrtBalanced", eval_metric="TotalF1:average=Macro",
        early_stopping_rounds=150, random_seed=a.seed, thread_count=-1, verbose=100,
    )
    t0 = time.time()
    model.fit(Pool(X.iloc[tr], y[tr]), eval_set=Pool(X.iloc[va], y[va]), use_best_model=True)
    print(f"trained in {time.time() - t0:.0f}s, best iteration {model.get_best_iteration()}", flush=True)

    proba = model.predict_proba(X.iloc[te])
    pred = proba.argmax(1)
    yt = y[te]

    def scores(yt, pred, proba=None) -> dict:
        rep = classification_report(yt, pred, labels=range(4), target_names=LABELS, output_dict=True, zero_division=0)
        out = {
            "accuracy": accuracy_score(yt, pred), "balanced_accuracy": balanced_accuracy_score(yt, pred),
            "macro_f1": f1_score(yt, pred, average="macro"), "weighted_f1": f1_score(yt, pred, average="weighted"),
            "quadratic_kappa": cohen_kappa_score(yt, pred, weights="quadratic"), "mcc": matthews_corrcoef(yt, pred),
            "within_one_level": float((np.abs(yt - pred) <= 1).mean()),
            "critical_recall": rep["Critical"]["recall"],
            "per_class": {l: {k: rep[l][k] for k in ("precision", "recall", "f1-score", "support")} for l in LABELS},
        }
        if proba is not None:
            out["log_loss"] = log_loss(yt, proba, labels=range(4))
        return out

    metrics = {"n_train": len(tr), "n_val": len(va), "n_test": len(te), "best_iteration": int(model.get_best_iteration()),
               "against_llm_labels": scores(yt, pred, proba)}

    src_path = Path(a.source) if a.source else next(
        (p for p in (ROOT / "data" / "complaints_description_only_cleaned.latest.csv",
                     ROOT / "data" / "complaints_description_only_cleaned.csv") if p.exists()), None)
    if src_path is not None:
        src = pd.read_csv(src_path)[["complaint_id", "label"]].rename(columns={"label": "source_label"})
        m = df.iloc[te][["complaint_id"]].merge(src, on="complaint_id", how="left")
        ok = m["source_label"].notna().to_numpy()
        if ok.any():
            ys = m.loc[ok, "source_label"].map({l: i for i, l in enumerate(LABELS)}).astype(int).to_numpy()
            metrics["against_source_labels_same_test_rows"] = scores(ys, pred[ok])
            llm_vs_src = scores(ys, yt[ok])
            metrics["llm_labels_vs_source_labels_same_rows"] = {k: llm_vs_src[k] for k in ("accuracy", "macro_f1", "quadratic_kappa")}

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    model.save_model(str(out / "catboost_desc_only.cbm"))
    (out / "label_map.json").write_text(json.dumps(
        {"labels": LABELS, "embedding_model": ENCODER, "features": "e0..e383 (description only, no complaint type)"},
        indent=1), "utf-8")
    (out / "metrics.json").write_text(json.dumps(metrics, indent=1), "utf-8")
    pd.DataFrame(confusion_matrix(yt, pred, labels=range(4)), index=[f"true_{l}" for l in LABELS],
                 columns=[f"pred_{l}" for l in LABELS]).to_csv(out / "confusion_matrix.csv")
    pd.DataFrame({"complaint_id": df.iloc[te]["complaint_id"].to_numpy(), "true": [LABELS[i] for i in yt],
                  "pred": [LABELS[i] for i in pred], "confidence": proba.max(1).round(4)}).to_csv(
        out / "test_predictions.csv", index=False)

    m1 = metrics["against_llm_labels"]
    print("\n=== Test set (vs LLM labels) ===")
    print(f"accuracy {m1['accuracy']:.3f} | macro F1 {m1['macro_f1']:.3f} | quadratic kappa {m1['quadratic_kappa']:.3f} | "
          f"within one level {m1['within_one_level']:.3f} | Critical recall {m1['critical_recall']:.3f}")
    print(classification_report(yt, pred, labels=range(4), target_names=LABELS, digits=3))
    print(pd.read_csv(out / "confusion_matrix.csv", index_col=0))
    if "against_source_labels_same_test_rows" in metrics:
        s = metrics["against_source_labels_same_test_rows"]
        print(f"\nSame test rows vs the ORIGINAL source labels: accuracy {s['accuracy']:.3f}, macro F1 {s['macro_f1']:.3f} "
              f"(LLM labels themselves vs source: accuracy {metrics['llm_labels_vs_source_labels_same_rows']['accuracy']:.3f})")
    print(f"\nsaved to {out}")


if __name__ == "__main__":
    main()
