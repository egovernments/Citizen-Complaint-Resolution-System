"""How many Critical complaints can a safety net catch, and at what cost in false alarms?

Reproduces the held-out 10% test split of the EARLIER single-split model (same seed and procedure),
scores the model in model/ on it, and measures:
  * Critical recall / alarm rate when escalating on P(Critical) >= t, for a range of t
  * the same for a keyword rule layer (model/critical_rules.json)
  * the two combined (either one escalates)

    python training/critical_recall_analysis.py                  # prints the tables
    python training/critical_recall_analysis.py --write          # also writes model/critical_guard.json

IMPORTANT: the current packaged model comes from the 5-fold run and was trained on ALL rows, including this
test split, so its numbers here are in-sample and flatter the model (the script prints a warning). To measure
honestly, score the earlier single-split model (take model/ from git history) or save the 5-fold out-of-fold
probabilities in the notebook and analyse those.

Honest limit: "Critical" here is the label in llm_labels.csv. Catching 100% of those still does not prove
every real emergency is caught; verify against a human-labelled set when one exists.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "model"))
from severity_predictor import SeverityModel, text_for_model  # noqa: E402

LABELS = ["Low", "Medium", "High", "Critical"]


def rule_hits(texts: list[str], rules: list[dict]) -> list[list[str]]:
    compiled = [(r["id"], re.compile(r["pattern"], re.I)) for r in rules]
    return [[rid for rid, rx in compiled if rx.search(t)] for t in texts]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "labelling" / "output" / "llm_labels.csv"))
    ap.add_argument("--targets", default="0.90,0.95,0.98")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    df = pd.read_csv(a.data)
    df["text"] = df["description"].map(text_for_model)
    df = df[df["text"].str.len() > 0].reset_index(drop=True)
    y = df["label"].map({l: i for i, l in enumerate(LABELS)}).astype(int).to_numpy()
    idx = np.arange(len(df))
    _, rest = train_test_split(idx, test_size=0.2, stratify=y, random_state=42)
    _, te = train_test_split(rest, test_size=0.5, stratify=y[rest], random_state=42)   # same split as training
    test = df.iloc[te].reset_index(drop=True)
    is_crit = (y[te] == 3)
    print(f"test rows {len(te)}, Critical {is_crit.sum()} ({is_crit.mean():.1%})")

    metrics_file = ROOT / "model" / "metrics.json"
    if metrics_file.exists() and "cross_validation" in json.loads(metrics_file.read_text("utf-8")):
        print("WARNING: this model was trained on all rows (5-fold run + final fit), so the test rows below were in its")
        print("training data and the results are optimistic. Use an earlier single-split model or out-of-fold probabilities.\n")
    model = SeverityModel(str(ROOT / "model"))
    p = model.predict_proba(test["text"].tolist())
    pc = p[:, 3]
    argmax_crit = p.argmax(1) == 3
    print(f"\nplain model (argmax = Critical): recall {argmax_crit[is_crit].mean():.1%}, alarms {argmax_crit.mean():.1%} of all complaints")

    rules = json.loads((ROOT / "model" / "critical_rules.json").read_text("utf-8"))["rules"] if (ROOT / "model" / "critical_rules.json").exists() else []
    hits = rule_hits(test["text"].tolist(), rules) if rules else [[] for _ in range(len(test))]
    rule_flag = np.array([bool(h) for h in hits])
    if rules:
        print(f"keyword rules alone: recall {rule_flag[is_crit].mean():.1%}, alarms {rule_flag.mean():.1%}, precision {is_crit[rule_flag].mean():.1%}")
        per = pd.DataFrame({r["id"]: [sum(r["id"] in h for h, c in zip(hits, is_crit) if c), sum(r["id"] in h for h in hits)] for r in rules},
                           index=["critical_hit", "all_hit"]).T
        per["precision"] = (per.critical_hit / per.all_hit.replace(0, np.nan)).round(2)
        print(per.sort_values("all_hit", ascending=False).to_string())

    print("\nEscalate when P(Critical) >= t   (with and without the keyword rules)")
    print(f"{'t':>6} | {'model: recall':>13} {'alarms':>7} {'precision':>9} | {'+rules: recall':>14} {'alarms':>7} {'precision':>9}")
    rows = []
    for t in [0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02]:
        m = pc >= t
        c = m | rule_flag
        rows.append((t, m[is_crit].mean(), m.mean(), is_crit[m].mean() if m.any() else 0, c[is_crit].mean(), c.mean(), is_crit[c].mean() if c.any() else 0))
        print(f"{t:6.2f} | {rows[-1][1]:13.1%} {rows[-1][2]:7.1%} {rows[-1][3]:9.1%} | {rows[-1][4]:14.1%} {rows[-1][5]:7.1%} {rows[-1][6]:9.1%}")

    chosen = {}
    for target in [float(x) for x in a.targets.split(",")]:
        ok = [r for r in rows if r[4] >= target]
        best = max(ok, key=lambda r: r[0]) if ok else rows[-1]        # highest threshold that still reaches the target
        chosen[f"recall_{int(target * 100)}"] = {"threshold": best[0], "recall": round(best[4], 4), "alarm_rate": round(best[5], 4), "precision": round(best[6], 4)}
        print(f"\nTo reach >= {target:.0%} Critical recall (with rules): t = {best[0]}, recall {best[4]:.1%}, {best[5]:.1%} of complaints raise an alarm, precision {best[6]:.1%}")

    missed = test[is_crit & ~(pc >= 0.1) & ~rule_flag]
    print(f"\nCritical complaints still missed at t = 0.10 + rules: {len(missed)} of {is_crit.sum()}")
    for _, r in missed.head(8).iterrows():
        print("  -", r["text"][:140])

    if a.write:
        out = {"basis": "held-out 10% test of the packaged model against llm_labels.csv", "n_test": int(len(te)),
               "n_critical": int(is_crit.sum()), "targets": chosen,
               "rules_sha256": hashlib.sha256((ROOT / "model" / "critical_rules.json").read_bytes()).hexdigest() if rules else None}
        (ROOT / "model" / "critical_guard_analysis.json").write_text(json.dumps(out, indent=2) + "\n", "utf-8", newline="\n")
        print("wrote model/critical_guard_analysis.json")


if __name__ == "__main__":
    main()
