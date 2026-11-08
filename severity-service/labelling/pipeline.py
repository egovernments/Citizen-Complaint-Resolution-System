"""Iterative severity-labelling pipeline.

Every labelling pass is a *run* kept under labelling/runs/<run_id>/ with a manifest that records the
rubric version, prompt hash, model and settings that produced it. Runs can be compared, partly redone
(only the unclear or disagreeing rows), reviewed by people, and layered into one promoted label file.

    python labelling/pipeline.py status
    python labelling/pipeline.py label   --run-id r2 --model gemini-3.1-flash-lite            # label everything not done yet
    python labelling/pipeline.py label   --run-id r3 --model gemini-3.1-flash-lite --select unclear --base-run r2
    python labelling/pipeline.py report  r2
    python labelling/pipeline.py compare r1 r2
    python labelling/pipeline.py review-export --run r2 --select disagree-source --limit 300
    python labelling/pipeline.py promote r2 --overlay r3 --reviews labelling/review/r2_disagree-source.csv

Standard library only; the labelling itself is done by llm_label.py.
"""
import argparse
import csv
import hashlib
import json
import random
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RUNS = HERE / "runs"
REVIEW = HERE / "review"
OUTPUT = HERE / "output"
CURRENT = OUTPUT / "llm_labels.csv"          # the promoted ("current") labels used for training
LEVELS = ["Low", "Medium", "High", "Critical"]
RUN_FIELDS = ["complaint_id", "llm_label", "unclear", "reason"]
SELECTIONS = ["all", "unclear", "disagree-source"]


# ---------------------------------------------------------------- helpers
def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_path() -> Path:
    data = ROOT / "data"
    for name in ("complaints_description_only_cleaned.latest.csv", "complaints_description_only_cleaned.csv"):
        if (data / name).exists():
            return data / name
    raise SystemExit("cleaned dataset not found in data/")


def sha256_file(path: Path, normalise_newlines: bool = False) -> str:
    raw = Path(path).read_bytes()
    if normalise_newlines:
        raw = raw.replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def prompt_sha() -> str:
    return sha256_file(HERE / "prompts" / "system.md", normalise_newlines=True)


def rubric_version() -> str:
    return json.loads((HERE / "rubric.json").read_text("utf-8"))["version"]


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:        # also reads files saved by Excel (BOM)
        return [r for r in csv.DictReader(f)]


def load_source() -> dict[str, dict]:
    return {r["complaint_id"]: r for r in read_csv(source_path())}      # keeps file order


def run_dir(run_id: str) -> Path:
    if not run_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for c in run_id):
        raise SystemExit(f"bad run id {run_id!r}: use letters, digits, '.', '_' or '-'")
    return RUNS / run_id


def read_manifest(run_id: str) -> dict:
    f = run_dir(run_id) / "manifest.json"
    return json.loads(f.read_text("utf-8")) if f.exists() else {}


def write_manifest(run_id: str, manifest: dict) -> None:
    d = run_dir(run_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", "utf-8", newline="\n")


def load_run_labels(run_id: str) -> dict[str, dict]:
    """All labels of a run (labels.csv plus any parallel part files); first occurrence of an id wins."""
    d = run_dir(run_id)
    files = sorted(d.glob("labels*.csv"), key=lambda p: (p.name != "labels.csv", p.name))
    out: dict[str, dict] = {}
    for f in files:
        for r in read_csv(f):
            label = r.get("llm_label") or r.get("label")
            if r.get("complaint_id") and label in LEVELS and r["complaint_id"] not in out:
                out[r["complaint_id"]] = {"label": label, "unclear": str(r.get("unclear", "")).lower() == "true",
                                          "reason": r.get("reason", "")}
    if not files:
        raise SystemExit(f"run {run_id!r} has no labels yet")
    return out


def write_run_labels(run_id: str, labels: dict[str, dict], order: list[str]) -> None:
    d = run_dir(run_id)
    tmp = d / "labels.tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(RUN_FIELDS)
        for i in order:
            if i in labels:
                l = labels[i]
                w.writerow([i, l["label"], str(l["unclear"]).lower(), l["reason"]])
    tmp.replace(d / "labels.csv")


def scores(labels: dict[str, dict], source: dict[str, dict]) -> dict:
    ids = [i for i in labels if i in source]
    ix = {l: k for k, l in enumerate(LEVELS)}
    conf = {a: {b: 0 for b in LEVELS} for a in LEVELS}
    for i in ids:
        conf[source[i]["label"]][labels[i]["label"]] += 1
    n = len(ids)
    exact = sum(conf[l][l] for l in LEVELS)
    within1 = sum(c for a in LEVELS for b, c in conf[a].items() if abs(ix[a] - ix[b]) <= 1)
    per_level = {l: (conf[l][l] / sum(conf[l].values()) if sum(conf[l].values()) else None) for l in LEVELS}
    return {"rows_compared": n, "exact_agreement": exact / n if n else None, "within_one_level": within1 / n if n else None,
            "per_source_level_exact": per_level, "confusion_source_rows_vs_run_columns": conf}


# ---------------------------------------------------------------- commands
def cmd_status(a) -> None:
    ver, ph = rubric_version(), prompt_sha()
    print(f"current rubric v{ver}, prompt {ph[:10]}\n")
    runs = sorted(p for p in RUNS.glob("*") if (p / "manifest.json").exists()) if RUNS.exists() else []
    if not runs:
        print("no runs yet")
    for p in runs:
        m = json.loads((p / "manifest.json").read_text("utf-8"))
        stale = "STALE (rubric/prompt changed since)" if m.get("prompt_sha256") != ph else "current"
        print(f"{p.name:28s} {m.get('status', '?'):9s} rows {m.get('rows_labelled', '?')}/{m.get('rows_target', '?')} "
              f"rubric v{m.get('rubric_version')}  {m.get('provider')}/{m.get('model')}  [{stale}]")
    mf = OUTPUT / "llm_labels.manifest.json"
    if mf.exists():
        m = json.loads(mf.read_text("utf-8"))
        print(f"\npromoted labels: {CURRENT.name} <- base {m['base_run']}, overlays {m['overlays'] or '-'}, "
              f"human-reviewed rows {m['rows_from_reviews']}, {m['rows']} rows, promoted {m['promoted']}")
    else:
        print("\nno promoted labels manifest yet (run `promote`)")


def cmd_register(a) -> None:
    """Record an existing labels file as a run (for labels made before runs were tracked)."""
    d = run_dir(a.run_id)
    if (d / "manifest.json").exists():
        raise SystemExit(f"run {a.run_id!r} already exists")
    d.mkdir(parents=True, exist_ok=True)
    src = {}
    for r in read_csv(Path(a.labels)):
        label = r.get("llm_label") or r.get("label")
        if label in LEVELS and r.get("complaint_id"):
            src[r["complaint_id"]] = {"label": label, "unclear": str(r.get("unclear", "")).lower() == "true", "reason": r.get("reason", "")}
    source = load_source()
    write_run_labels(a.run_id, src, list(source))
    write_manifest(a.run_id, {
        "run_id": a.run_id, "registered": now(), "status": "complete" if len(src) >= len(source) else "partial",
        "rubric_version": a.rubric_version or rubric_version(), "prompt_sha256": prompt_sha(),
        "provider": a.provider, "model": a.model, "selection": "all", "base_run": None,
        "input_file": source_path().name, "input_sha256": sha256_file(source_path()),
        "rows_target": len(source), "rows_labelled": len(src), "notes": a.note,
    })
    finalize(a.run_id)


def finalize(run_id: str) -> dict:
    d = run_dir(run_id)
    m = read_manifest(run_id)
    source = load_source()
    labels = load_run_labels(run_id)
    write_run_labels(run_id, labels, list(source))
    ids_file = d / "ids.txt"
    target = len([ln for ln in ids_file.read_text("utf-8").splitlines() if ln.strip()]) if ids_file.exists() else len(source)
    counts = Counter(l["label"] for l in labels.values())
    m.update(rows_target=target, rows_labelled=len(labels), status="complete" if len(labels) >= target else "partial",
             label_counts={l: counts.get(l, 0) for l in LEVELS}, updated=now())
    write_manifest(run_id, m)
    report = {"run_id": run_id, "rows": len(labels), "label_counts": m["label_counts"],
              "label_share": {l: round(counts.get(l, 0) / len(labels), 4) if labels else 0 for l in LEVELS},
              "unclear_share": round(sum(l["unclear"] for l in labels.values()) / len(labels), 4) if labels else 0,
              "against_source_labels": scores(labels, source)}
    (d / "report.json").write_text(json.dumps(report, indent=2) + "\n", "utf-8", newline="\n")
    return report


def cmd_report(a) -> None:
    r = finalize(a.run)
    s = r["against_source_labels"]
    print(f"run {a.run}: {r['rows']} rows")
    print("distribution:", {l: f"{r['label_counts'][l]} ({r['label_share'][l]:.1%})" for l in LEVELS})
    print(f"unclear: {r['unclear_share']:.1%}")
    if s["exact_agreement"] is not None:
        print(f"agreement with source labels: exact {s['exact_agreement']:.1%}, within one level {s['within_one_level']:.1%}")
        print("per source level (exact):", {k: (f"{v:.1%}" if v is not None else "-") for k, v in s["per_source_level_exact"].items()})
    print(f"written to {run_dir(a.run) / 'report.json'}")


def select_ids(base_run: str, how: str) -> list[str]:
    labels, source = load_run_labels(base_run), load_source()
    if how == "unclear":
        return [i for i in source if i in labels and labels[i]["unclear"]]
    if how == "disagree-source":
        return [i for i in source if i in labels and labels[i]["label"] != source[i]["label"]]
    if how.startswith("disagree-with:"):
        other = load_run_labels(how.split(":", 1)[1])
        return [i for i in source if i in labels and i in other and labels[i]["label"] != other[i]["label"]]
    raise SystemExit(f"unknown selection {how!r}")


def cmd_label(a) -> None:
    d = run_dir(a.run_id)
    d.mkdir(parents=True, exist_ok=True)
    m = read_manifest(a.run_id)
    if a.select != "all":
        if not a.base_run:
            raise SystemExit("--select needs --base-run")
        ids = select_ids(a.base_run, a.select)
        (d / "ids.txt").write_text("\n".join(ids) + "\n", "utf-8", newline="\n")
        print(f"{len(ids)} rows selected ({a.select}) from run {a.base_run}")
    if not m:
        m = {"run_id": a.run_id, "created": now(), "status": "running", "rubric_version": rubric_version(),
             "prompt_sha256": prompt_sha(), "provider": a.provider, "model": a.model, "batch_size": a.batch_size,
             "selection": a.select, "base_run": a.base_run, "input_file": source_path().name,
             "input_sha256": sha256_file(source_path()), "notes": a.note, "commands": []}
    elif (m.get("model"), m.get("provider")) != (a.model, a.provider):
        raise SystemExit(f"run {a.run_id!r} was started with {m.get('provider')}/{m.get('model')}; a run uses one model. "
                         "Start a new run id to change model.")
    elif m.get("prompt_sha256") != prompt_sha():
        raise SystemExit(f"the rubric/prompt changed since run {a.run_id!r} started; start a new run id.")
    out = d / (f"labels.part-{a.start}-{a.end or 'end'}.csv" if (a.start or a.end) else "labels.csv")
    done = [str(p) for p in d.glob("labels*.csv")]
    cmd = [sys.executable, str(HERE / "llm_label.py"), "--input", str(source_path()), "--output", str(out),
           "--provider", a.provider, "--model", a.model, "--batch-size", str(a.batch_size), "--also-done", *done]
    if (d / "ids.txt").exists():
        cmd += ["--ids-file", str(d / "ids.txt")]
    for flag, val in (("--start", a.start), ("--end", a.end), ("--limit", a.limit), ("--sample", a.sample)):
        if val:
            cmd += [flag, str(val)]
    if a.key_env:
        cmd += ["--key-env", a.key_env]
    if a.rpm:
        cmd += ["--rpm", str(a.rpm)]
    if a.dry_run:
        cmd.append("--dry-run")
    m.setdefault("commands", []).append({"time": now(), "options": {
        "select": a.select, "base_run": a.base_run, "start": a.start, "end": a.end, "limit": a.limit, "sample": a.sample,
        "key_env": a.key_env, "batch_size": a.batch_size, "dry_run": bool(a.dry_run)}})
    write_manifest(a.run_id, m)
    rc = subprocess.call(cmd)
    if a.dry_run:
        return
    r = finalize(a.run_id)
    print(f"run {a.run_id}: {r['rows']} rows labelled ({read_manifest(a.run_id)['status']})")
    if rc != 0:
        raise SystemExit(rc)


def cmd_compare(a) -> None:
    A, B = load_run_labels(a.run_a), load_run_labels(a.run_b)
    source = load_source()
    ids = [i for i in source if i in A and i in B]
    conf = {x: {y: 0 for y in LEVELS} for x in LEVELS}
    diff = []
    for i in ids:
        conf[A[i]["label"]][B[i]["label"]] += 1
        if A[i]["label"] != B[i]["label"]:
            diff.append(i)
    n = len(ids)
    print(f"{a.run_a} vs {a.run_b}: {n} common rows, agree {1 - len(diff) / n:.1%}" if n else "no common rows")
    print(f"rows = {a.run_a}, columns = {a.run_b}")
    print(f"{'':10s}" + "".join(f"{l:>10s}" for l in LEVELS))
    for x in LEVELS:
        print(f"{x:10s}" + "".join(f"{conf[x][y]:10d}" for y in LEVELS))
    out = RUNS / "_compare" / f"{a.run_a}_vs_{a.run_b}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["complaint_id", "description", "source_label", a.run_a, a.run_b])
        for i in diff:
            w.writerow([i, source[i]["description"], source[i]["label"], A[i]["label"], B[i]["label"]])
    print(f"{len(diff)} differing rows written to {out}")


def cmd_review_export(a) -> None:
    labels, source = load_run_labels(a.run), load_source()
    ids = select_ids(a.run, a.select)
    if a.limit and len(ids) > a.limit:
        ids = sorted(random.Random(a.seed).sample(ids, a.limit), key=list(source).index)
    REVIEW.mkdir(exist_ok=True)
    out = REVIEW / f"{a.run}_{a.select.replace(':', '-')}.csv"
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["complaint_id", "description", "source_label", "llm_label", "llm_unclear", "llm_reason", "reviewed_label", "notes"])
        for i in ids:
            w.writerow([i, source[i]["description"], source[i]["label"], labels[i]["label"], labels[i]["unclear"], labels[i]["reason"], "", ""])
    print(f"{len(ids)} rows to review written to {out}\nFill `reviewed_label` (Low / Medium / High / Critical), save, then `promote --reviews {out}`.")


def read_reviews(files: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for f in files:
        for r in read_csv(Path(f)):
            v = (r.get("reviewed_label") or "").strip().capitalize()
            if v in LEVELS and r.get("complaint_id"):
                out[r["complaint_id"]] = v
            elif v:
                raise SystemExit(f"{f}: invalid reviewed_label {r.get('reviewed_label')!r} for {r.get('complaint_id')}")
    return out


def cmd_promote(a) -> None:
    source = load_source()
    layers = [a.base_run, *a.overlay]
    loaded = {rid: load_run_labels(rid) for rid in layers}
    reviews = read_reviews(a.reviews)
    rows, missing, from_reviews = [], [], 0
    for i, s in source.items():
        label = None
        for rid in layers:                      # later layers override earlier ones
            if i in loaded[rid]:
                label = (loaded[rid][i]["label"], loaded[rid][i]["unclear"], rid)
        if i in reviews:
            label = (reviews[i], False, "human")
            from_reviews += 1
        if label is None:
            missing.append(i)
            continue
        rows.append([i, s["description"], label[0], str(label[1]).lower(), label[2]])
    if missing and not a.allow_partial:
        raise SystemExit(f"{len(missing)} complaints have no label in {layers}; label them first or pass --allow-partial")
    out = Path(a.out) if a.out else CURRENT
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["complaint_id", "description", "label", "unclear", "label_source"])
        w.writerows(rows)
    counts = Counter(r[2] for r in rows)
    manifest = {"promoted": now(), "file": out.name, "rows": len(rows), "base_run": a.base_run, "overlays": a.overlay,
                "review_files": [{"file": Path(f).name, "sha256": sha256_file(Path(f))} for f in a.reviews],
                "rows_from_reviews": from_reviews, "rubric_version": rubric_version(), "prompt_sha256": prompt_sha(),
                "label_counts": {l: counts.get(l, 0) for l in LEVELS}, "rows_missing": len(missing)}
    out.with_name(out.stem + ".manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8", newline="\n")
    print(f"promoted {len(rows)} labels to {out}: {manifest['label_counts']} ({from_reviews} from human review)")


# ---------------------------------------------------------------- CLI
def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="list runs, whether they match the current rubric, and what is promoted").set_defaults(fn=cmd_status)

    p = sub.add_parser("register", help="record an existing labels file as a run")
    p.add_argument("--run-id", required=True); p.add_argument("--labels", required=True)
    p.add_argument("--provider", default="unknown"); p.add_argument("--model", default="unknown")
    p.add_argument("--rubric-version", default=""); p.add_argument("--note", default="")
    p.set_defaults(fn=cmd_register)

    p = sub.add_parser("label", help="start or resume a labelling run")
    p.add_argument("--run-id", required=True); p.add_argument("--model", required=True)
    p.add_argument("--provider", default="gemini", choices=["gemini", "groq"])
    p.add_argument("--batch-size", type=int, default=80)
    p.add_argument("--select", default="all", help="all | unclear | disagree-source | disagree-with:RUN (the last three need --base-run)")
    p.add_argument("--base-run", default="")
    p.add_argument("--start", type=int, default=0); p.add_argument("--end", type=int, default=0)
    p.add_argument("--key-env", default=""); p.add_argument("--rpm", type=float, default=0)
    p.add_argument("--limit", type=int, default=0); p.add_argument("--sample", type=int, default=0)
    p.add_argument("--note", default=""); p.add_argument("--dry-run", action="store_true")
    p.set_defaults(fn=cmd_label)

    p = sub.add_parser("report", help="distribution and agreement with the source labels for a run")
    p.add_argument("run"); p.set_defaults(fn=cmd_report)

    p = sub.add_parser("compare", help="agreement and differing rows between two runs")
    p.add_argument("run_a"); p.add_argument("run_b"); p.set_defaults(fn=cmd_compare)

    p = sub.add_parser("review-export", help="write a CSV of rows for people to review")
    p.add_argument("--run", required=True)
    p.add_argument("--select", default="disagree-source", help="unclear | disagree-source | disagree-with:RUN")
    p.add_argument("--limit", type=int, default=0); p.add_argument("--seed", type=int, default=42)
    p.set_defaults(fn=cmd_review_export)

    p = sub.add_parser("promote", help="build the current label file from a run, overlay runs and human reviews")
    p.add_argument("base_run"); p.add_argument("--overlay", nargs="*", default=[]); p.add_argument("--reviews", nargs="*", default=[])
    p.add_argument("--out", default=""); p.add_argument("--allow-partial", action="store_true")
    p.set_defaults(fn=cmd_promote)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
