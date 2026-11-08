"""Score a severity model bundle on an independently human-labelled set.

This is the fair yardstick across improvement rounds: the labels come from people (two labellers and a
tie-breaker, using only labelling/rubric.json), never from a model, and the set is never used for training.

    python training/score_human_set.py --labels path/to/human_labels.csv                 # scores model/
    python training/score_human_set.py --labels human.csv --bundle path/to/severity_model

The CSV needs `description` and `final_label` (Low / Medium / High / Critical); other columns are ignored
(see "Label file format" in labelling/README.md). Rows with an invalid label are reported and skipped.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
LABELS = ["Low", "Medium", "High", "Critical"]


def load_model(bundle: Path):
    """Load SeverityModel from the bundle's own predictor file."""
    spec = importlib.util.spec_from_file_location("bundle_severity_predictor", Path(bundle) / "severity_predictor.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SeverityModel(str(bundle))


def metrics_from_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    from sklearn.metrics import cohen_kappa_score, confusion_matrix, f1_score

    cm = confusion_matrix(y_true, y_pred, labels=range(4))
    crit_tp = cm[3, 3]
    per_class = {}
    for k, name in enumerate(LABELS):
        tp, support, flagged = cm[k, k], cm[k].sum(), cm[:, k].sum()
        per_class[name] = {"recall": float(tp / support) if support else None,
                           "precision": float(tp / flagged) if flagged else None, "support": int(support)}
    return {
        "n": int(len(y_true)),
        "accuracy": float((y_true == y_pred).mean()),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", labels=range(4), zero_division=0)),
        "quadratic_kappa": float(cohen_kappa_score(y_true, y_pred, weights="quadratic")),
        "within_one_level": float((np.abs(y_true - y_pred) <= 1).mean()),
        "critical_recall": float(crit_tp / cm[3].sum()) if cm[3].sum() else None,
        "critical_precision": float(crit_tp / cm[:, 3].sum()) if cm[:, 3].sum() else None,
        "per_class": per_class,
        "confusion_true_rows_by_predicted_cols": cm.tolist(),
    }


def score_bundle(bundle: Path, labels_csv: Path, label_col: str = "final_label", text_col: str = "description") -> dict:
    df = pd.read_csv(labels_csv, encoding="utf-8-sig")
    for col in (text_col, label_col):
        if col not in df.columns:
            raise SystemExit(f"{labels_csv}: missing column {col!r} (found {list(df.columns)})")
    ok = df[label_col].isin(LABELS)
    if (~ok).any():
        print(f"skipping {int((~ok).sum())} rows with a missing or invalid {label_col}")
    df = df[ok & df[text_col].notna()].reset_index(drop=True)
    if df.empty:
        raise SystemExit("no usable rows")
    y_true = df[label_col].map({l: i for i, l in enumerate(LABELS)}).astype(int).to_numpy()
    preds = load_model(Path(bundle)).predict(df[text_col].astype(str).tolist())
    y_pred = np.array([p["severity_id"] for p in preds])
    return metrics_from_predictions(y_true, y_pred)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", required=True)
    ap.add_argument("--bundle", default=str(ROOT / "model"))
    ap.add_argument("--json", default="", help="also write the metrics to this file")
    a = ap.parse_args()
    m = score_bundle(Path(a.bundle), Path(a.labels))
    print(f"{m['n']} human-labelled complaints scored")
    print(f"accuracy {m['accuracy']:.3f} | macro F1 {m['macro_f1']:.3f} | quadratic kappa {m['quadratic_kappa']:.3f} | "
          f"within one level {m['within_one_level']:.3f}")
    cr, cp = m["critical_recall"], m["critical_precision"]
    print("Critical recall:", "n/a (no Critical rows)" if cr is None else f"{cr:.3f}", "| Critical precision:", "n/a" if cp is None else f"{cp:.3f}")
    print("rows = human label, columns = model:", LABELS)
    for name, row in zip(LABELS, m["confusion_true_rows_by_predicted_cols"]):
        print(f"  {name:9s}", row)
    if a.json:
        Path(a.json).write_text(json.dumps(m, indent=2) + "\n", "utf-8", newline="\n")


if __name__ == "__main__":
    main()
