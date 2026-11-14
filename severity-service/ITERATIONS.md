# Iteration log

One row per improvement round. Add a row for every round, including the ones that did not help.
Each round changes one thing and is judged on the same yardstick (see "Improving it iteratively" in `README.md`).

| # | What changed (one thing) | Rubric | Label run / promoted from | Model | Cross-validation mean (macro F1 / Critical recall / within one level) | Independent human test set | Decision and notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline: first rubric (v0.3) applied by an LLM to all 58,640 complaints; model trained on those labels | v0.3 | `run-001-initial` | `catboost_desc_only-2026-11-08` (CPU, 300 trees, single 80/10/10 split) | not run (single split: macro F1 0.734 / Critical recall 0.616 / within one 0.940 on a 10% test) | not built yet | Starting point. LLM labels agree with the original labels 60.5% exact; no human-checked labels yet. Replaced by round 1. |
| 1 | Retrain on the same labels with 5-fold stratified cross-validation on a GPU (up to 2,000 trees), final model on all rows (2,181 trees) | v0.3 | `run-001-initial` | `catboost_desc_only-cv5-2026-11-08` | macro F1 0.761 (±0.002) / Critical recall 0.626 (±0.013) / within one 0.949 (accuracy 0.781) | not built yet | Kept: first properly measured model; now in `model/`. Not directly comparable with round 0, which used a single split. Folds stopped near the 2,000-tree limit. |

## How to add a row

When you ship a model, `python training/ship_model.py <bundle> --note "the one thing that changed" --apply` adds the row for you (rubric version, label runs, cross-validation numbers, human-set score if given, and the decision). To add one by hand:

1. Describe the single change (a rubric rule, a relabelled subset, a data rebuild, a parameter, a threshold).
2. Fill the label run and rubric version from `python labelling/pipeline.py status`.
3. Fill the metrics from the notebook's cross-validation output (`model/metrics.json` after shipping).
4. Fill the human test set score once that set exists (`python training/score_human_set.py`), and write the decision: kept, discarded, or needs more evidence, with the reason.

## Ideas not tried yet

- Build the independent, human-labelled test set (about 2,000 random complaints, two labellers and a tie-breaker).
- Have people review the complaints where the LLM and the original labels disagree, starting with High versus Medium and Critical versus High.
- Save the cross-validation out-of-fold probabilities in the notebook, so the Critical safety net can be measured honestly on the current model.
- Try more than 2,000 trees (the folds stopped at 1,945 to 1,998).
- Tune `review_threshold` from out-of-fold probabilities.
- Compare a larger multilingual encoder.
