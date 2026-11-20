"""Build the reviewable CSV for the random 2,000-complaint sample labelled by Gemini.

    python labelling/export_sample_csv.py

Reads labelling/output/sample2000_gemini31.csv (from llm_label.py) and the cleaned dataset,
and writes labelling/output/sample2000_gemini_labels.csv with the complaint text, the
existing label, the Gemini label and reason, and whether they match.
UTF-8 with BOM so Excel shows the Tamil complaints correctly.
"""
import csv
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
OUT = HERE / "output"
SRC = next(p for p in (DATA / "complaints_description_only_cleaned.latest.csv",
                       DATA / "complaints_description_only_cleaned.csv") if p.exists())


def main() -> None:
    with open(OUT / "sample2000_gemini31.csv", encoding="utf-8", newline="") as f:
        gem = {r["complaint_id"]: r for r in csv.DictReader(f)}
    with open(SRC, encoding="utf-8", newline="") as f:
        src = {r["complaint_id"]: r for r in csv.DictReader(f)}
    cols = ["complaint_id", "description", "source_label", "gemini_label", "gemini_unclear", "gemini_reason", "matches_source"]
    target = OUT / "sample2000_gemini_labels.csv"
    with open(target, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for i in sorted(gem):
            s, g = src[i], gem[i]
            w.writerow([i, s["description"], s["label"], g["llm_label"], g["unclear"], g["reason"],
                        g["llm_label"] == s["label"]])
    print(f"wrote {len(gem)} rows to {target}")


if __name__ == "__main__":
    main()
