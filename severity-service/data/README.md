# Description-only cleaned training data

`complaints_description_only_cleaned.csv` is the handoff dataset for the first
description-only severity-model training run. It contains only:

- `complaint_id` — a newly assigned opaque ID; it cannot be joined to the source
  complaint number.
- `description` — PII-minimised complaint text, and the only model input.
- `label` — the existing severity label.

It deliberately excludes source complaint numbers, dates, complaint type,
category and all other workbook fields. Location-only text is retained in the
description; where a person's name occurs together with an address, both are
redacted. The source workbook remains local and must not be shared.

## Reproduce / refresh

From `severity-service` run:

```bash
python scripts/prepare_description_only_data.py
```

The script reads `data/GCC_PGR_FY2024-25_labelled_1.xlsx`, removes direct PII
(including person-plus-address combinations), uses location-insensitive matching
to remove near-duplicate descriptions, drops conflicting duplicate labels, and selects
at most 20,000 unique records per label by a stable content hash. This limits
the Medium/High majority classes without discarding scarce Critical examples.
It writes the CSV and `complaints_description_only_cleaned.manifest.json`.
The manifest records exact input/output hashes, counts, selection rules and the
PII transformations so that reruns are auditable.

## For future work:

Use the checked-in CSV directly; do not reopen or copy the source workbook.
Train with `description` only and `label` as the target. The field names differ
from the old notebook intentionally: complaint type is outside the first model's
scope. Verify the output hash against the manifest before starting a run.

## Verifying the data (known mismatch)

Rebuilding with the script reproduces `output_sha256` in the manifest exactly, so the manifest describes the script's own output.
The committed CSV is not byte-identical to that output: git stores it with LF line endings (the script writes CRLF), and one row
(`clean-001223`) still contains a personal name in the script's output but is redacted in the committed CSV. The committed CSV is
what the labelling and the model were built on. The two should be reconciled by whoever owns the cleaning step (check the
personal-data rules against that row); until then a hash check of the committed file against the manifest will not pass.
The source workbook was committed once by mistake; it is untracked and git-ignored now, but remains in earlier history.
