"""Create the reusable, PII-minimised description-only training data.

The input workbook must stay local. This script never writes source complaint
numbers, dates, categories, or types to its outputs. Location-only text is kept;
person-plus-address combinations are redacted.
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

# These patterns cover direct identifiers found in free-form Indian PGR text.
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
URL = re.compile(r"\b(?:https?://|www\.)\S+", re.I)
MANGLED_URL = re.compile(r"\bhttps?(?:://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+){2,}\S*", re.I)
PHONE = re.compile(r"(?<!\d)(?:\+?91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}(?!\d)")
AADHAAR = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.I)
COMPLAINT_NO = re.compile(r"\b\d{4}\s*-\s*\d{3}[A-Z]{3}\b", re.I)
SERVICE_ID = re.compile(r"\b(?:TNEBCL|TNEB|GCC|CMC)[A-Z0-9-]*\d[A-Z0-9-]*\b", re.I)
# Addresses are only removed from the published description when they occur with
# an explicit person's name.  Location by itself is retained under the agreed
# GDPR interpretation, but is ignored for duplicate matching below.
ADDRESS = re.compile(
    r"(?:\b(?:no\.?|door\s*(?:no\.?|number)|house\s*(?:no\.?|number)|"
    r"flat\s*(?:no\.?|number)|plot\s*(?:no\.?|number))\s*[:#-]?\s*\d[\w/,-]*"
    r"|\b\d{1,5}(?:\s*[-/]\s*\d{1,5})?\s*,?\s*[\w .'-]{1,60}\s+"
    r"(?:street|st\.?|road|rd\.?|avenue|nagar|colony|layout|lane|cross)\b"
    r"|\b(?:residing|living)\s+at\s+[^.!?\n]{1,160})", re.I
)
EXPLICIT_PERSON = re.compile(
    r"\b(?i:from|my\s+name\s+is|name\s*(?:is|:)|contact\s+person\s*(?:is|:)|"
    r"mr\.?|mrs\.?|ms\.?|dr\.?)\s+(?:[A-Z]\.?\s*)?[A-Z][A-Za-z'-]{1,}"
    r"(?:\s+[A-Z][A-Za-z'-]{1,}){0,2}"
)
INITIAL_PERSON = re.compile(r"\b[A-Z]\.\s*[A-Z][A-Za-z'-]{1,}(?:\s+[A-Z][A-Za-z'-]{1,}){0,2}\b")
LOCATION_FOR_DEDUPE = re.compile(
    r"\b(?:at|near|opp(?:osite)?|behind|beside)\s+[^,.!?;]{1,60}\s+"
    r"(?:street|st\.?|road|rd\.?|avenue|nagar|colony|layout|lane|cross|chennai)\b"
    r"|\b[\w .'-]{1,60}\s+(?:street|st\.?|road|rd\.?|avenue|nagar|colony|layout|lane|cross)\b"
    r"|\bchennai\b", re.I
)
SPACE = re.compile(r"\s+")
NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
ADDRESS_HINTS = (" no", "door", "house", "flat", "plot", "street", " st", " road", " rd", "avenue", "nagar", "colony", "layout", "lane", "cross", "residing", "living")
DEDUPE_LOCATION_HINTS = (" no", "door", "house", "flat", "plot", "street", " st", " road", " rd", "avenue", "chennai")
PERSON_HINTS = ("from ", "my name", "name ", "name:", "contact person", "mr ", "mr.", "mrs ", "mrs.", "ms ", "ms.", "dr ", "dr.")


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
            values = {}
            for cell in row.findall(NS + "c"):
                column = cell.get("r").rstrip("0123456789")
                if column == "E" or column == "G":
                    values[column] = cell_value(cell)
            row.clear()
            if values.get("E") != "TEXT_FOR_MODEL":
                yield values.get("E", ""), values.get("G", "")


def remove_pii(text: str) -> str:
    """Remove direct identifiers, retaining location unless it identifies a person."""
    text = text.replace("\u200b", " ").replace("\ufeff", " ")
    # Remove real email addresses before handling the workbook's ``type@address``
    # template; otherwise an email could leave its local part behind.
    text = EMAIL.sub("[email removed]", text)
    for pattern, replacement in (
        (URL, "[link removed]"), (MANGLED_URL, "[link removed]"),
        (PHONE, "[phone removed]"), (AADHAAR, "[id removed]"),
        (PAN, "[id removed]"), (COMPLAINT_NO, "[reference removed]"),
        (SERVICE_ID, "[reference removed]"),
    ):
        text = pattern.sub(replacement, text)
    # A name alone or an address alone is retained.  Redact both only when they
    # occur close together, which is the combination that identifies a person.
    lower_text = text.casefold()
    has_address_hint = any(hint in lower_text for hint in ADDRESS_HINTS)
    has_person_hint = any(hint in lower_text for hint in PERSON_HINTS) or bool(INITIAL_PERSON.search(text))
    people = (list(EXPLICIT_PERSON.finditer(text)) + list(INITIAL_PERSON.finditer(text))) if has_person_hint else []
    addresses = list(ADDRESS.finditer(text)) if has_address_hint and people else []
    spans: list[tuple[int, int]] = []
    for person in people:
        for address in addresses:
            if abs(address.start() - person.end()) <= 180 or abs(person.start() - address.end()) <= 180:
                # Prefer a city/postcode terminus; otherwise stop at the street
                # marker.  This removes the full address without swallowing the
                # complaint that may follow it in the same sentence.
                tail = text[address.start():address.start() + 180]
                terminus = re.search(
                    r"\b(?:chennai|tamil\s+nadu|india)\b(?:\s*[-,]?\s*\d{3}\s?\d{3})?"
                    r"|\b\d{3}\s?\d{3}\b", tail, re.I)
                if terminus is None:
                    terminus = re.search(r"\b(?:street|st\.?|road|rd\.?|avenue|nagar|colony|layout|lane|cross)\b", tail, re.I)
                address_end = address.start() + (terminus.end() if terminus else address.end())
                spans.append((min(person.start(), address.start()), max(person.end(), address_end)))
    # Collapse overlapping name/address spans before replacement.  Applying
    # overlapping original offsets one-by-one corrupts the remaining text.
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    for start, end in reversed(merged):
        text = text[:start] + "[personal details removed]" + text[end:]
    return SPACE.sub(" ", text).strip(" .,;:-}{")


def dedupe_key(description: str) -> str:
    # Location-only text remains in the model input, but cannot make otherwise
    # identical complaints distinct training examples.
    lower_description = description.casefold()
    without_location = description
    if any(hint in lower_description for hint in DEDUPE_LOCATION_HINTS):
        without_location = ADDRESS.sub(" ", without_location)
        without_location = LOCATION_FOR_DEDUPE.sub(" ", without_location)
    return SPACE.sub(" ", NON_WORD.sub(" ", without_location.casefold())).strip()


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
    key_row_counts = Counter()
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
        key_row_counts[key] += 1
        existing = records_by_key.get(key)
        if existing is None:
            records_by_key[key] = (description, label)
        elif existing[1] != label:
            conflict_keys.add(key)

    for key in conflict_keys:
        records_by_key.pop(key, None)
    # These exclusion categories are deliberately disjoint, so their row counts
    # plus ``selected_total`` equal the source row count.
    discarded["duplicate_same_label"] = sum(
        count - 1 for key, count in key_row_counts.items() if key not in conflict_keys
    )
    discarded["duplicate_conflicting_label_rows"] = sum(key_row_counts[key] for key in conflict_keys)
    discarded["duplicate_conflicting_label_groups"] = len(conflict_keys)

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
            "dedupe": "casefolded punctuation-insensitive, location-insensitive description; conflicting labels excluded",
            "pii_handling": "emails, normal/mangled URLs, Indian phones, Aadhaar, PAN, complaint/service references, and person-plus-address combinations removed; location alone retained",
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
