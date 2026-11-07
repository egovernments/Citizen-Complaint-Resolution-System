"""Create the reusable, PII-minimised description-only training data.

The input workbook must stay local.  This script never writes a source complaint
number, date, category, type, address, or the original text to its outputs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import iterparse
from zipfile import ZipFile


NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
LABELS = ("Low", "Medium", "High", "Critical")
DEFAULT_INPUT = Path("data/GCC_PGR_FY2024-25_labelled_1.xlsx")
DEFAULT_OUTPUT = Path("data/complaints_description_only_cleaned.csv")
DEFAULT_MANIFEST = Path("data/complaints_description_only_cleaned.manifest.json")

# These patterns cover the direct identifiers found in free-form Indian PGR text.
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
URL = re.compile(r"\b(?:https?://|www\.)\S+", re.I)
PHONE = re.compile(r"(?<!\d)(?:\+?91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}(?!\d)")
AADHAAR = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.I)
COMPLAINT_NO = re.compile(r"\b\d{4}\s*-\s*\d{3}[A-Z]{3}\b", re.I)
PINCODE = re.compile(r"(?<!\d)\d{6}(?!\d)")
NAME_VALUE = re.compile(
    r"\b(?:my\s+name\s+is|name\s*(?:is|:)|contact\s+person\s*(?:is|:)|"
    r"(?:mr|mrs|ms|dr)\.?\s+)[A-Z][A-Za-z .'-]{1,70}(?=[,;.!\n]|$)", re.I
)
ADDRESS_VALUE = re.compile(
    r"\b(?:address\s*(?::|is)\s*|residing\s+at\s+|living\s+at\s+|"
    r"house\s*(?:no|number)\s*(?::|is)?\s*|flat\s*(?:no|number)\s*(?::|is)?\s*)[^\n]{1,160}", re.I
)
SPACE = re.compile(r"\s+")
NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def cell_value(cell) -> str:
    if cell.get("t") == "inlineStr":
        return "".join(cell.itertext())
    value = cell.find(NS + "v")
    return "" if value is None else (value.text or "")


def input_rows(workbook: Path):
    """Yield only the description and label columns from sheet 1 without Excel deps."""
    with ZipFile(workbook) as archive, archive.open("xl/worksheets/sheet1.xml") as sheet:
        for _, row in iterparse(sheet, events=("end",)):
            if row.tag != NS + "row":
                continue
            values = {
                cell.get("r").rstrip("0123456789"): cell_value(cell)
                for cell in row.findall(NS + "c")
            }
            row.clear()
            if values.get("E") != "TEXT_FOR_MODEL":
                yield values.get("E", ""), values.get("G", "")


def remove_pii(text: str) -> str:
    """Remove direct identifiers while retaining the complaint's safety meaning."""
    text = text.replace("\u200b", " ").replace("\ufeff", " ")
    # Remove real email addresses before handling the workbook's ``type@address``
    # template; otherwise an email could leave its local part behind.
    text = EMAIL.sub("[email removed]", text)
    # The workbook uses ``complaint type@address``; the address must not leak.
    text = text.split("@", 1)[0]
    for pattern, replacement in (
        (URL, "[link removed]"), (PHONE, "[phone removed]"), (AADHAAR, "[id removed]"),
        (PAN, "[id removed]"), (COMPLAINT_NO, "[reference removed]"),
        (PINCODE, "[postcode removed]"), (NAME_VALUE, "[name removed]"),
        (ADDRESS_VALUE, "[address removed]"),
    ):
        text = pattern.sub(replacement, text)
    return SPACE.sub(" ", text).strip(" .,;:-}{")


def dedupe_key(description: str) -> str:
    return SPACE.sub(" ", NON_WORD.sub(" ", description.casefold())).strip()


def stable_rank(description: str) -> str:
    return hashlib.sha256(description.encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--per-label", type=int, default=20_000,
                        help="maximum unique examples for each label (default: 20,000)")
    args = parser.parse_args()

    if args.per_label < 1:
        parser.error("--per-label must be positive")
    if not args.input.is_file():
        parser.error(f"input workbook not found: {args.input}")

    raw_counts = Counter()
    discarded = Counter()
    records_by_key: dict[str, tuple[str, str]] = {}
    conflict_keys: set[str] = set()
    for raw_description, label in input_rows(args.input):
        raw_counts[label] += 1
        if label not in LABELS:
            discarded["invalid_label"] += 1
            continue
        description = remove_pii(raw_description)
        key = dedupe_key(description)
        if len(key.split()) < 3:
            discarded["too_short_after_cleaning"] += 1
            continue
        existing = records_by_key.get(key)
        if existing is None:
            records_by_key[key] = (description, label)
        elif existing[1] != label:
            conflict_keys.add(key)
        else:
            discarded["duplicate_same_label"] += 1

    for key in conflict_keys:
        records_by_key.pop(key, None)
    discarded["duplicate_conflicting_label"] = len(conflict_keys)

    by_label: dict[str, list[str]] = defaultdict(list)
    for description, label in records_by_key.values():
        by_label[label].append(description)
    selected: list[tuple[str, str]] = []
    for label in LABELS:
        descriptions = sorted(by_label[label], key=stable_rank)[:args.per_label]
        discarded["over_per_label_cap"] += max(0, len(by_label[label]) - len(descriptions))
        selected.extend((description, label) for description in descriptions)
    selected.sort(key=lambda row: (row[1], stable_rank(row[0])))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=("complaint_id", "description", "label"))
        writer.writeheader()
        for number, (description, label) in enumerate(selected, start=1):
            writer.writerow({"complaint_id": f"clean-{number:06d}", "description": description, "label": label})

    content_hash = hashlib.sha256(args.output.read_bytes()).hexdigest()
    manifest = {
        "format_version": 1,
        "created_at_utc": datetime.now(UTC).isoformat(),
        "input_file": args.input.name,
        "input_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "selection": {
            "input_columns": ["TEXT_FOR_MODEL", "SEVERITY"],
            "output_columns": ["complaint_id", "description", "label"],
            "model_input": "description only",
            "per_label_cap": args.per_label,
            "dedupe": "casefolded punctuation-insensitive cleaned description; conflicting labels excluded",
            "pii_handling": "addresses after @, emails, URLs, Indian phones, Aadhaar, PAN, complaint references, postcodes, and common explicit name/address fields removed",
        },
        "counts": {
            "source_by_label": dict(raw_counts),
            "discarded": dict(discarded),
            "selected_by_label": dict(Counter(label for _, label in selected)),
            "selected_total": len(selected),
        },
        "output_sha256": content_hash,
    }
    args.manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
