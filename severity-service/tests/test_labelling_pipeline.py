import csv
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

LAB = Path(__file__).resolve().parent.parent / "labelling"


@pytest.fixture()
def pl(tmp_path, monkeypatch):
    """The pipeline module pointed at a throw-away workspace with a 6-complaint dataset."""
    spec = importlib.util.spec_from_file_location("pipeline_under_test", LAB / "pipeline.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["pipeline_under_test"] = mod
    spec.loader.exec_module(mod)

    (tmp_path / "prompts").mkdir()
    shutil.copy(LAB / "prompts" / "system.md", tmp_path / "prompts" / "system.md")
    shutil.copy(LAB / "rubric.json", tmp_path / "rubric.json")
    src = tmp_path / "source.csv"
    rows = [("c1", "dog bit a child", "Critical"), ("c2", "street light off", "Medium"), ("c3", "tax query", "Low"),
            ("c4", "drain overflow", "High"), ("c5", "garbage not taken", "Medium"), ("c6", "illegal banner", "Low")]
    with open(src, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["complaint_id", "description", "label"])
        w.writerows(rows)
    monkeypatch.setattr(mod, "HERE", tmp_path)
    monkeypatch.setattr(mod, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(mod, "REVIEW", tmp_path / "review")
    monkeypatch.setattr(mod, "OUTPUT", tmp_path / "output")
    monkeypatch.setattr(mod, "CURRENT", tmp_path / "output" / "llm_labels.csv")
    monkeypatch.setattr(mod, "source_path", lambda: src)
    return mod


def write_labels(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["complaint_id", "llm_label", "unclear", "reason"])
        w.writerows(rows)


R1 = [("c1", "Critical", "false", "bite"), ("c2", "High", "true", "dark"), ("c3", "Low", "false", "q"),
      ("c4", "High", "false", "water"), ("c5", "Medium", "false", "bin"), ("c6", "Medium", "true", "banner")]


def test_register_report_and_status(pl, capsys):
    labels = pl.HERE / "in.csv"
    write_labels(labels, R1)
    pl.main(["register", "--run-id", "r1", "--labels", str(labels), "--provider", "gemini", "--model", "m1"])
    m = json.loads((pl.RUNS / "r1" / "manifest.json").read_text("utf-8"))
    assert m["status"] == "complete" and m["rows_labelled"] == 6 and m["label_counts"]["High"] == 2
    rep = json.loads((pl.RUNS / "r1" / "report.json").read_text("utf-8"))
    assert rep["against_source_labels"]["exact_agreement"] == pytest.approx(4 / 6)   # c1, c3, c4, c5 match
    pl.main(["status"])
    assert "[current]" in capsys.readouterr().out


def test_status_flags_stale_runs_after_prompt_change(pl, capsys):
    write_labels(pl.HERE / "in.csv", R1)
    pl.main(["register", "--run-id", "r1", "--labels", str(pl.HERE / "in.csv")])
    (pl.HERE / "prompts" / "system.md").write_text("a different rubric prompt\n", "utf-8")
    pl.main(["status"])
    assert "STALE" in capsys.readouterr().out


def test_targeted_selection_and_compare(pl):
    write_labels(pl.HERE / "in.csv", R1)
    pl.main(["register", "--run-id", "r1", "--labels", str(pl.HERE / "in.csv")])
    assert pl.select_ids("r1", "unclear") == ["c2", "c6"]
    assert pl.select_ids("r1", "disagree-source") == ["c2", "c6"]           # High vs Medium, Medium vs Low
    write_labels(pl.RUNS / "r2" / "labels.csv", [("c2", "Medium", "false", ""), ("c6", "Low", "false", "")])
    pl.write_manifest("r2", {"run_id": "r2"})
    assert pl.select_ids("r1", "disagree-with:r2") == ["c2", "c6"]
    pl.main(["compare", "r1", "r2"])
    assert (pl.RUNS / "_compare" / "r1_vs_r2.csv").exists()


def test_review_export_and_promote_layers_in_order(pl):
    write_labels(pl.HERE / "in.csv", R1)
    pl.main(["register", "--run-id", "r1", "--labels", str(pl.HERE / "in.csv")])
    write_labels(pl.RUNS / "r2" / "labels.csv", [("c2", "Medium", "false", "redo"), ("c6", "Low", "false", "redo")])
    pl.write_manifest("r2", {"run_id": "r2"})

    pl.main(["review-export", "--run", "r1", "--select", "unclear"])
    review = pl.REVIEW / "r1_unclear.csv"
    rows = list(csv.DictReader(open(review, encoding="utf-8-sig", newline="")))
    assert [r["complaint_id"] for r in rows] == ["c2", "c6"]
    for r in rows:                                    # a person decides c6
        r["reviewed_label"] = "high" if r["complaint_id"] == "c6" else ""
    with open(review, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    pl.main(["promote", "r1", "--overlay", "r2", "--reviews", str(review)])
    final = {r["complaint_id"]: r for r in csv.DictReader(open(pl.CURRENT, encoding="utf-8", newline=""))}
    assert final["c1"]["label_source"] == "r1"                     # untouched row stays from the base run
    assert final["c2"]["label"] == "Medium" and final["c2"]["label_source"] == "r2"   # overlay beat the base
    assert final["c6"]["label"] == "High" and final["c6"]["label_source"] == "human"  # review beat the overlay
    man = json.loads((pl.OUTPUT / "llm_labels.manifest.json").read_text("utf-8"))
    assert man["rows_from_reviews"] == 1 and man["overlays"] == ["r2"] and man["rows"] == 6


def test_promote_refuses_incomplete_labels(pl):
    write_labels(pl.HERE / "in.csv", R1[:4])
    pl.main(["register", "--run-id", "r1", "--labels", str(pl.HERE / "in.csv")])
    with pytest.raises(SystemExit):
        pl.main(["promote", "r1"])
    pl.main(["promote", "r1", "--allow-partial"])
    assert len(list(csv.DictReader(open(pl.CURRENT, encoding="utf-8", newline="")))) == 4


def test_invalid_review_label_is_rejected(pl):
    write_labels(pl.HERE / "in.csv", R1)
    pl.main(["register", "--run-id", "r1", "--labels", str(pl.HERE / "in.csv")])
    bad = pl.HERE / "bad.csv"
    bad.write_text("complaint_id,reviewed_label\nc1,Severe\n", "utf-8")
    with pytest.raises(SystemExit):
        pl.main(["promote", "r1", "--reviews", str(bad)])


def test_run_id_is_validated(pl):
    with pytest.raises(SystemExit):
        pl.run_dir("../escape")
