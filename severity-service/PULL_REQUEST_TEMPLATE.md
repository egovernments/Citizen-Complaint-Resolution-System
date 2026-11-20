<!-- Copy this into the pull request description. One improvement round (or one self-contained change) per PR. -->

## What changed (one thing)

<!-- A rubric rule, a relabelled subset, a data rebuild, a model setting, a threshold, or a tool/doc change. -->

**Lever:** rubric / labels / data / model settings / decision rule / tooling or docs

## Why

<!-- The theme or weak class this targets, with 2 or 3 real example complaints (no personal data). -->

## Evidence

| | Before | After |
| --- | --- | --- |
| Rubric version | | |
| Label run(s) promoted from (`pipeline.py status`) | | |
| Model version | | |
| Cross-validation: macro F1 (±spread) | | |
| Cross-validation: Critical recall (±spread) | | |
| Within one level | | |
| Independent human-labelled set (macro F1 / Critical recall / n) | | |

<!-- Cross-validation scores on different label versions are not comparable; if the labels changed, say so and rely on the human set. -->

## Checklist

- [ ] `python scripts/check_round.py` passes (paste its last line: `__/__ checks passed`)
- [ ] One change only, and a row added to `ITERATIONS.md` (`training/ship_model.py` does this when it ships a model)
- [ ] Rubric changed? `version` bumped, `build_prompt.py` rerun, affected rows relabelled (new run or overlay) and promoted again
- [ ] Doubtful rows exported for review (`pipeline.py review-export`), and any reviewed labels included
- [ ] New model checked with `training/ship_model.py` (gate passed, or the override is explained in the log row)
- [ ] No keys, raw workbook, saved notebook outputs, or per-run label files in the diff

## Files this PR should contain

Rubric diff (if any) · new run `manifest.json` and `report.json` · review CSVs · promoted `output/llm_labels.csv` and its manifest · the model bundle in `model/` (if retrained) · `ITERATIONS.md` · docs.

## Reviewer notes

<!-- What to look at first; anything uncertain; what was deliberately not changed. -->
