import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "training"))

import score_human_set as sh  # noqa: E402
import ship_model as sm  # noqa: E402


def cv(macro_f1, crit, std=0.01, acc=0.78, w1=0.95):
    return {"folds": 5, "trees": 100,
            "mean": {"macro_f1": macro_f1, "critical_recall": crit, "accuracy": acc, "within_one_level": w1},
            "std": {"macro_f1": std, "critical_recall": std, "accuracy": std, "within_one_level": std}}


def test_gate_accepts_gain_and_noise_but_refuses_a_real_drop():
    old = cv(0.76, 0.62, std=0.01)
    assert sm.gate(cv(0.78, 0.65), old)[0]                       # clear gain
    assert sm.gate(cv(0.755, 0.615), old)[0]                     # inside the fold-to-fold noise
    ok, lines = sm.gate(cv(0.76, 0.58), old)                     # Critical recall fell by 0.04, more than the spread
    assert not ok and any("REFUSED" in l for l in lines)
    assert not sm.gate(cv(0.70, 0.62), old)[0]                   # macro F1 fell


def test_gate_refuses_without_cross_validation_and_skips_when_labels_changed():
    assert not sm.gate({}, cv(0.76, 0.62))[0]
    ok, lines = sm.gate(cv(0.50, 0.30), cv(0.76, 0.62), labels_changed=True)
    assert ok and "skipped" in lines[0]


def test_gate_uses_the_human_set_when_given_and_it_beats_cross_validation():
    old_h, new_h = {"macro_f1": 0.70, "critical_recall": 0.60}, {"macro_f1": 0.72, "critical_recall": 0.55}
    ok, lines = sm.gate(cv(0.90, 0.90), cv(0.76, 0.62), new_h, old_h)   # great CV, but worse Critical recall on people's labels
    assert not ok and any("human set" in l for l in lines)
    assert sm.gate(cv(0.1, 0.1), cv(0.76, 0.62), {"macro_f1": 0.72, "critical_recall": 0.62}, old_h)[0]


def test_version_rules():
    assert sm.new_version("catboost_desc_only-cv5-2026-11-08", 5, "catboost_desc_only-cv5-r2") == "catboost_desc_only-cv5-r2"
    with pytest.raises(SystemExit):
        sm.new_version("catboost_desc_only-a", 5, "catboost_desc_only-a")          # same as the current one
    with pytest.raises(SystemExit):
        sm.new_version("catboost_desc_only-a", 5, "some-other-name")               # wrong shape
    assert sm.current_version('model_version: str = "catboost_desc_only-cv5-2026-11-08"') == "catboost_desc_only-cv5-2026-11-08"


def test_iteration_row_is_added_after_the_last_numbered_row_with_the_next_number():
    text = "# Log\n\n| # | what |\n| --- | --- |\n| 0 | base |\n| 1 | round one |\n\n## How to add a row\n"
    out = sm.append_iteration_row(text, lambda n: f"| {n} | new |")
    lines = out.split("\n")
    assert lines[lines.index("| 1 | round one |") + 1] == "| 2 | new |"
    assert out.count("| 2 | new |") == 1 and "## How to add a row" in out


def test_archive_with_path_tricks_is_refused(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("../outside.txt", "x")
    with pytest.raises(SystemExit):
        sm.open_bundle(z)


def test_incomplete_bundle_is_reported(tmp_path):
    (tmp_path / "label_map.json").write_text("{}")
    problems = sm.check_bundle(tmp_path, smoke=False)
    assert any("severity_catboost.cbm" in p for p in problems)


def test_real_bundle_passes_the_checks_and_dry_run_writes_nothing(capsys):
    before = (ROOT / "ITERATIONS.md").read_text("utf-8")
    assert sm.check_bundle(ROOT / "model", smoke=False) == []
    sm.main([str(ROOT / "model"), "--note", "test only", "--version", "catboost_desc_only-test-dryrun", "--skip-smoke"])
    out = capsys.readouterr().out
    assert "dry run: nothing written" in out and "catboost_desc_only-test-dryrun" in out
    assert (ROOT / "ITERATIONS.md").read_text("utf-8") == before


def test_human_set_metrics():
    y = np.array([0, 1, 2, 3, 3, 3])
    p = np.array([0, 1, 2, 3, 2, 3])
    m = sh.metrics_from_predictions(y, p)
    assert m["n"] == 6 and m["accuracy"] == pytest.approx(5 / 6)
    assert m["critical_recall"] == pytest.approx(2 / 3) and m["critical_precision"] == pytest.approx(1.0)
    assert m["within_one_level"] == 1.0
