# Labelling

Everything needed to label complaints for the severity **evaluation set** (about 2,000 complaints).

- `rubric.json` is the single source of truth for what Low / Medium / High / Critical mean.
- `prompts/system.md` is generated from it by `build_prompt.py` (`--check` verifies it is current); `prompts/user.md` is the per-complaint template.
- Labelled data is used only to evaluate the model, never to train it.

## Process

1. Draw a sample of complaints. PII must already be removed and duplicates dropped; that happens upstream and is not part of this folder.
2. Two people label each complaint independently, using only `rubric.json`. Neither sees the other's label or the model's prediction.
3. Disagreements are resolved by a third reviewer, and the final label is recorded along with both original labels.
4. Report accuracy and Critical recall against the model, and annotator agreement (Cohen's kappa) between the two labellers.

## Label file format

CSV, one row per complaint:

| Column | Meaning |
| --- | --- |
| `complaint_id` | Id of the complaint |
| `description` | Cleaned complaint text |
| `complaint_type` | PGR display name |
| `label_a`, `label_b` | The two independent labels |
| `final_label` | Agreed label (Low / Medium / High / Critical) |
| `notes` | Optional free text on borderline cases |

## Changing the rules

Edit `rubric.json`, bump `version` in it and in `prompts/VERSION`, then run `python labelling/build_prompt.py`.
Do not relabel items already labelled under an earlier version without recording that.
