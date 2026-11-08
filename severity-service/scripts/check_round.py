"""Checks to run before opening a pull request for an improvement round.

    python scripts/check_round.py            # run from severity-service/; exits non-zero if a check fails
    python scripts/check_round.py --fast     # skip the test suite

Each check prints PASS or FAIL with what to do. A round is ready for review when everything passes.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
results: list[tuple[bool, str, str]] = []


def record(ok: bool, name: str, fail_detail: str = "", pass_detail: str = "") -> None:
    """fail_detail explains how to fix a failure; pass_detail is an optional note shown on success."""
    results.append((ok, name, fail_detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({pass_detail})" if ok and pass_detail else ""))
    if not ok and fail_detail:
        for ln in fail_detail.splitlines():
            print(f"        {ln}")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="ignore").stdout


def prompt_sha() -> str:
    return hashlib.sha256((ROOT / "labelling" / "prompts" / "system.md").read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def check_tracked_files() -> None:
    tracked = git("ls-files", "severity-service").splitlines()
    bad = [f for f in tracked if f.lower().endswith((".xlsx", ".xls")) or Path(f).name == ".env"
           or re.search(r"runs/[^/]+/labels[^/]*\.csv$", f)]
    record(not bad, "no raw workbook, .env or per-run label files are tracked",
           "tracked but must stay local:\n" + "\n".join(bad) + "\nfix: git rm --cached <file> (and rewrite history if it was ever pushed)")


def check_notebooks_clean() -> None:
    dirty = []
    for nb in list(ROOT.rglob("*.ipynb")):
        if "older_severity_model" in nb.parts or ".ipynb_checkpoints" in nb.parts:
            continue
        data = json.loads(nb.read_text("utf-8"))
        text = json.dumps(data)
        if any(c.get("outputs") for c in data["cells"] if c["cell_type"] == "code") or re.search(r"Users\\\\\\\\|/Users/|/home/", text):
            dirty.append(str(nb.relative_to(ROOT)))
    record(not dirty, "notebooks have no saved outputs or local paths",
           "clear outputs before committing: " + ", ".join(dirty))


def check_keys_not_in_repo() -> None:
    env = ROOT / "labelling" / ".env"
    if not env.exists():
        record(True, "no real API keys in tracked files", pass_detail="no labelling/.env here, nothing to compare")
        return
    secrets = []
    for line in env.read_text("utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if "KEY" in k and len(v.strip()) > 20 and "PASTE" not in v:
                secrets.append(v.strip())
    hits = []
    for f in git("ls-files", "severity-service").splitlines():
        p = REPO / f
        if p.suffix in (".py", ".md", ".json", ".ipynb", ".txt", ".yml", ".example", ".csv") and p.exists() and p.stat().st_size < 30_000_000:
            t = p.read_text("utf-8", errors="ignore")
            if any(s in t for s in secrets):
                hits.append(f)
    record(not hits, "no real API keys in tracked files", "a key from labelling/.env appears in:\n" + "\n".join(hits))


def check_prompt_matches_rubric() -> None:
    r = subprocess.run([sys.executable, "labelling/build_prompt.py", "--check"], cwd=ROOT, capture_output=True, text=True)
    record(r.returncode == 0, "prompt matches the rubric", "run: python labelling/build_prompt.py")


def check_labels_not_stale() -> None:
    mf = ROOT / "labelling" / "output" / "llm_labels.manifest.json"
    if not mf.exists():
        record(False, "promoted labels have a manifest", "run: python labelling/pipeline.py promote <run>")
        return
    m = json.loads(mf.read_text("utf-8"))
    ok = m.get("prompt_sha256") == prompt_sha()
    record(ok, "promoted labels were made with the current rubric",
           "the rubric/prompt changed after the labels were promoted.\nrelabel (pipeline.py label ...) and promote again, or explain in the PR why not")


def check_model_version_logged() -> None:
    cfg = (ROOT / "app" / "config.py").read_text("utf-8")
    m = re.search(r"catboost_desc_only-[A-Za-z0-9._-]+", cfg)
    log = (ROOT / "ITERATIONS.md").read_text("utf-8")
    record(bool(m) and m.group(0) in log, "the model version in app/config.py has a row in ITERATIONS.md",
           "add the round to ITERATIONS.md (training/ship_model.py does this when it ships a model)")


def check_model_matches_metrics() -> None:
    m = json.loads((ROOT / "model" / "metrics.json").read_text("utf-8"))
    readme = (ROOT / "README.md").read_text("utf-8")
    cv = (m.get("cross_validation") or {}).get("mean")
    if not cv:
        record(True, "README quotes the shipped model's metrics", pass_detail="no cross-validation results in model/metrics.json, skipped")
        return
    want = f"{cv['accuracy'] * 100:.1f}%"
    record(want in readme, "README quotes the shipped model's metrics", f"model/metrics.json says accuracy {want} but the README does not contain it; update the README")


def check_tests() -> None:
    r = subprocess.run([sys.executable, "-m", "pytest", "tests", "-q", "-x"], cwd=ROOT, capture_output=True, text=True)
    tail = [ln for ln in r.stdout.splitlines() if ln.strip()][-3:]
    record(r.returncode == 0, "tests pass", " ".join(tail)[-140:] if r.returncode == 0 else "\n".join(tail))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="skip the test suite")
    a = ap.parse_args()
    check_tracked_files()
    check_notebooks_clean()
    check_keys_not_in_repo()
    check_prompt_matches_rubric()
    check_labels_not_stale()
    check_model_version_logged()
    check_model_matches_metrics()
    if not a.fast:
        check_tests()
    failed = [n for ok, n, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + ("" if not failed else "; fix the FAIL lines above before opening a PR"))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
