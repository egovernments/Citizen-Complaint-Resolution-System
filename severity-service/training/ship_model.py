"""Check a retrained model bundle against the current one, ship it into model/, and record the round.

    python training/ship_model.py path/to/severity_model.zip --note "what changed (one thing)"          # plan only
    python training/ship_model.py path/to/severity_model.zip --note "..." --apply                       # do it
    python training/ship_model.py bundle --note "..." --human-set human_labels.csv --apply              # judge on the human set
    python training/ship_model.py bundle --note "..." --labels-changed --apply                          # labels changed: no metric gate

What it does (nothing is written without --apply):
  1. checks the bundle: files present, model loads, 384 features, four classes, matching label map, and a
     smoke prediction through the bundle's own predictor
  2. compares it with the model in model/ and refuses a regression:
       * with --human-set: on that independently human-labelled set (the fair yardstick), macro F1 and Critical
         recall may not drop
       * otherwise: on the 5-fold cross-validation means, they may not drop by more than the current model's
         fold-to-fold spread
       * with --labels-changed: the metric gate is skipped, because scores on different labels are not
         comparable (say why in --note)
  3. copies the files into model/, sets a new model version in app/config.py, app/schemas.py and the README
     example, and appends a row to ITERATIONS.md
--force ships despite a failed gate (the log row says so).
"""
import argparse
import json
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

BUNDLE_FILES = ["severity_catboost.cbm", "severity_catboost.pkl", "label_map.json", "metrics.json", "severity_predictor.py"]
REQUIRED = ["severity_catboost.cbm", "label_map.json", "metrics.json", "severity_predictor.py"]
LABELS = ["Low", "Medium", "High", "Critical"]
VERSION_RE = re.compile(r"catboost_desc_only-[A-Za-z0-9._-]+")


def open_bundle(path: Path) -> Path:
    path = Path(path)
    if path.is_dir():
        return path
    out = Path(tempfile.mkdtemp(prefix="severity_bundle_"))
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():                         # refuse path tricks in an archive from elsewhere
            norm = name.replace(chr(92), "/")
            if norm.startswith("/") or ".." in norm.split("/"):
                raise SystemExit(f"unsafe path in archive: {name}")
        z.extractall(out)
    inner = [p for p in out.iterdir() if p.is_dir()]
    return inner[0] if (not (out / "metrics.json").exists() and len(inner) == 1) else out


def check_bundle(bundle: Path, smoke: bool = True) -> list[str]:
    """Return a list of problems (empty = fine)."""
    problems = [f"missing file: {n}" for n in REQUIRED if not (bundle / n).exists()]
    if problems:
        return problems
    meta = json.loads((bundle / "label_map.json").read_text("utf-8"))
    if meta.get("labels") != LABELS:
        problems.append(f"label map is {meta.get('labels')}, expected {LABELS}")
    from catboost import CatBoostClassifier

    clf = CatBoostClassifier()
    clf.load_model(str(bundle / "severity_catboost.cbm"))
    if len(clf.feature_names_) != 384:
        problems.append(f"model has {len(clf.feature_names_)} features, expected 384")
    if len(clf.classes_) != 4:
        problems.append(f"model has {len(clf.classes_)} classes, expected 4")
    if smoke and not problems:
        from score_human_set import load_model

        r = load_model(bundle).predict(["Open manhole near the school, children could fall in"])[0]
        if r["severity"] not in LABELS:
            problems.append("smoke prediction returned an unexpected severity")
    return problems


def cv_numbers(metrics: dict) -> dict:
    cv = metrics.get("cross_validation")
    if not cv:
        return {}
    keys = ["accuracy", "macro_f1", "critical_recall", "within_one_level"]
    return {"folds": cv["n_folds"], "mean": {k: cv["mean"][k] for k in keys}, "std": {k: cv["std"][k] for k in keys},
            "trees": (metrics.get("final_model") or {}).get("iterations")}


def gate(new: dict, old: dict, human_new: dict | None = None, human_old: dict | None = None,
         labels_changed: bool = False) -> tuple[bool, list[str]]:
    """Decide whether the candidate may replace the current model. Returns (ok, explanation lines)."""
    lines = []
    if labels_changed:
        return True, ["labels changed: metric gate skipped (scores on different labels are not comparable); say why in --note"]
    if human_new and human_old:
        ok = True
        for k in ("macro_f1", "critical_recall"):
            n, o = human_new.get(k), human_old.get(k)
            lines.append(f"human set {k}: {o:.3f} -> {n:.3f} ({n - o:+.3f})")
            if n < o:
                ok = False
        return ok, lines + ([] if ok else ["REFUSED: worse on the independently human-labelled set"])
    if not new or not old:
        return False, ["cannot compare: one of the bundles has no cross-validation results (train with the notebook)"]
    ok = True
    for k in ("macro_f1", "critical_recall"):
        n, o, s = new["mean"][k], old["mean"][k], old["std"][k]
        d = n - o
        verdict = "better than the spread" if d > s else ("within noise" if abs(d) <= s else "worse than the spread")
        lines.append(f"cross-validation {k}: {o:.3f} (±{s:.3f}) -> {n:.3f} ({d:+.3f}, {verdict})")
        if d < -s:
            ok = False
    for k in ("accuracy", "within_one_level"):
        lines.append(f"cross-validation {k}: {old['mean'][k]:.3f} -> {new['mean'][k]:.3f} ({new['mean'][k] - old['mean'][k]:+.3f})")
    return ok, lines + ([] if ok else ["REFUSED: macro F1 or Critical recall dropped by more than the current model's fold-to-fold spread"])


def current_version(config_text: str) -> str:
    m = VERSION_RE.search(config_text)
    return m.group(0) if m else ""


def new_version(old: str, n_folds: int | None, explicit: str = "") -> str:
    v = explicit or f"catboost_desc_only-cv{n_folds or 0}-{date.today().isoformat()}"
    if not VERSION_RE.fullmatch(v):
        raise SystemExit(f"version must look like catboost_desc_only-<tag>, got {v!r}")
    if v == old:
        raise SystemExit(f"model version {v!r} is already in use; pass --version with a different tag")
    return v


def append_iteration_row(text: str, row_builder) -> str:
    """Add a row to the first table of ITERATIONS.md; row_builder gets the next round number."""
    lines = text.split("\n")
    rows = [i for i, l in enumerate(lines) if l.startswith("| ") and re.match(r"\|\s*\d+\s*\|", l)]
    if not rows:
        raise SystemExit("ITERATIONS.md has no numbered rows to extend")
    last = rows[-1]
    n = int(re.match(r"\|\s*(\d+)\s*\|", lines[last]).group(1)) + 1
    lines.insert(last + 1, row_builder(n))
    return "\n".join(lines)


def fmt_cv(c: dict) -> str:
    m, s = c["mean"], c["std"]
    return (f"macro F1 {m['macro_f1']:.3f} (±{s['macro_f1']:.3f}) / Critical recall {m['critical_recall']:.3f} (±{s['critical_recall']:.3f}) "
            f"/ within one {m['within_one_level']:.3f} (accuracy {m['accuracy']:.3f})")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bundle", help="folder or .zip produced by the training notebook or script")
    ap.add_argument("--note", required=True, help="the single thing that changed this round (goes in ITERATIONS.md)")
    ap.add_argument("--human-set", default="", help="independently human-labelled CSV to judge both models on")
    ap.add_argument("--labels-changed", action="store_true")
    ap.add_argument("--version", default="")
    ap.add_argument("--apply", action="store_true", help="write the changes (default: only show the plan)")
    ap.add_argument("--force", action="store_true", help="ship even if the gate refuses")
    ap.add_argument("--skip-smoke", action="store_true")
    a = ap.parse_args(argv)

    bundle = open_bundle(Path(a.bundle))
    problems = check_bundle(bundle, smoke=not a.skip_smoke)
    if problems:
        raise SystemExit("bundle is not usable:\n  - " + "\n  - ".join(problems))
    print("bundle OK: files present, model loads (384 features, 4 classes), label map matches")

    model_dir = ROOT / "model"
    new_m = json.loads((bundle / "metrics.json").read_text("utf-8"))
    old_m = json.loads((model_dir / "metrics.json").read_text("utf-8")) if (model_dir / "metrics.json").exists() else {}
    new_cv, old_cv = cv_numbers(new_m), cv_numbers(old_m)
    h_new = h_old = None
    if a.human_set:
        from score_human_set import score_bundle

        h_new, h_old = score_bundle(bundle, Path(a.human_set)), score_bundle(model_dir, Path(a.human_set))
    ok, lines = gate(new_cv, old_cv, h_new, h_old, a.labels_changed)
    print("\n".join(lines))
    if not ok and not a.force:
        raise SystemExit("not shipping (use --force to override, and explain in --note)")

    cfg = (ROOT / "app" / "config.py").read_text("utf-8")
    old_v = current_version(cfg)
    version = new_version(old_v, new_cv.get("folds"), a.version)
    manifest = ROOT / "labelling" / "output" / "llm_labels.manifest.json"
    pm = json.loads(manifest.read_text("utf-8")) if manifest.exists() else {}
    runs = f"`{pm['base_run']}`" + ("".join(f" + `{o}`" for o in pm.get("overlays", [])) or "") + (" + human reviews" if pm.get("rows_from_reviews") else "") if pm else "unknown"
    rubric = json.loads((ROOT / "labelling" / "rubric.json").read_text("utf-8"))["version"]

    def row(n):
        human = (f"macro F1 {h_new['macro_f1']:.3f} / Critical recall {h_new['critical_recall']:.3f} (n={h_new['n']})" if h_new else "not built yet")
        decision = "Shipped by `training/ship_model.py`." + (" Metric gate skipped: labels changed." if a.labels_changed else "") + (" Gate overridden with --force." if (not ok and a.force) else "")
        return f"| {n} | {a.note} | v{rubric} | {runs} | `{version}` | {fmt_cv(new_cv) if new_cv else 'n/a'} | {human} | {decision} |"

    print(f"\nplan: model version {old_v or '(none)'} -> {version}; copy {', '.join(n for n in BUNDLE_FILES if (bundle / n).exists())} into model/; "
          f"update app/config.py, app/schemas.py and the README example; add a row to ITERATIONS.md")
    if not a.apply:
        print("dry run: nothing written (add --apply)")
        return
    for n in BUNDLE_FILES:
        if (bundle / n).exists():
            shutil.copy2(bundle / n, model_dir / n)
    for rel in ("app/config.py", "app/schemas.py", "README.md"):
        p = ROOT / rel
        t = p.read_text("utf-8")
        if old_v:
            p.write_text(t.replace(old_v, version), "utf-8", newline="\n")
    it = ROOT / "ITERATIONS.md"
    it.write_text(append_iteration_row(it.read_text("utf-8"), row), "utf-8", newline="\n")
    print(f"shipped {version}. Next: run `python scripts/check_round.py`, then open a PR with the template in PULL_REQUEST_TEMPLATE.md.")


if __name__ == "__main__":
    main()
