# severity-service

A text classifier and API that reads a citizen complaint and predicts how severe it is:
**Low / Medium / High / Critical**. It uses only the complaint description (English or Tamil), so it can be called from any system that has the text.

This folder contains everything around that model: the data preparation, the severity rubric, an LLM-assisted labelling pipeline that can be repeated and reviewed by people, the training code, the trained model, and a FastAPI service with Swagger documentation.

## How it fits together

```
 raw labelled workbook (kept local, never committed)
        |  scripts/prepare_description_only_data.py   remove personal data, drop duplicates, cap class sizes
        v
 data/complaints_description_only_cleaned.csv          complaint_id, description, label   (58,640 rows)
        |
        |  labelling/   rubric.json -> prompt -> LLM labelling runs -> comparison -> human review -> promote
        v
 labelling/output/llm_labels.csv                       complaint_id, description, label, unclear, label_source
        |
        |  training/    sentence embeddings (384 numbers per text) -> CatBoost, 5-fold cross-validation
        v
 model/                                                severity_catboost.cbm + label map + predictor class
        |
        v
 app/                                                  FastAPI: POST /severity, POST /severity/batch, GET /health  (Swagger at /docs)
```

## Repository map

| Path | What it holds |
| --- | --- |
| `data/` | The cleaned, personal-data-free complaint dataset, its manifest (hashes, counts, cleaning rules) and `data/README.md` |
| `scripts/prepare_description_only_data.py` | Builds the cleaned dataset from the raw workbook |
| `labelling/` | The severity rubric (`rubric.json`), the generated prompt, the LLM labelling engine (`llm_label.py`), the iterative pipeline (`pipeline.py`), run records, review files, results and a detailed write-up (`labelling/README.md`) |
| `training/` | Training for the model: a notebook with 5-fold cross-validation, a local training script, the standalone predictor class, and a script that measures how many Critical complaints a safety net would catch (`training/README.md`) |
| `model/` | The trained model bundle: `severity_catboost.cbm`, a pickle copy, `label_map.json`, `metrics.json`, `severity_predictor.py`, and the keyword rules `critical_rules.json` (not used by the API yet) |
| `app/` | The FastAPI service that serves the model |
| `tests/` | Tests for the API and for the labelling pipeline |
| `ITERATIONS.md` | The log of improvement rounds: what changed, which label run and rubric version, the metrics and the decision. Add a row every round |
| `older_severity_model/` | The previous model (it also used a complaint-type field) with its own service, tests, container files and browser version. Kept for reference; it runs from inside that folder |

## What was asked and what is done

| # | What was asked | Status | What was done and where |
| --- | --- | --- | --- |
| 1 | Remove the complaint type from the scoring and the CatBoost training | Done | The model learns from the description only. The training data has no complaint-type column, the model has 384 embedding features and no category feature, and the API accepts but ignores a complaint type. The earlier model that used it is kept apart in `older_severity_model/`. See `training/`, `model/` and `app/`. |
| 2 | Structure the work so it can be done iteratively, and make it part of a pull request | Mostly done | `labelling/pipeline.py` keeps every labelling pass as a recorded run, compares runs, redoes only selected rows, supports human review and promotes the final labels. "Improving it iteratively" below and `ITERATIONS.md` describe how to run a round. The work is committed on its branch; **the pull request itself has not been opened yet.** |
| 3 | Store the labelling rules as prompts | Done | `labelling/rubric.json` is the single source of truth; `labelling/build_prompt.py` generates `labelling/prompts/system.md` from it, and `--check` catches a stale prompt. |
| 4 | Remove personal data (PII) | Done | `scripts/prepare_description_only_data.py` removes emails, phone numbers, links, identity numbers, complaint references and name-plus-address combinations; the manifest records the rules. |
| 5 | Remove duplicates | Done | Same script: near-duplicate descriptions are removed with location-insensitive matching, and texts with conflicting labels are dropped. |
| 6 | Pick a certain subset of the data | Done | Same script: at most 20,000 rows per label, chosen by a stable content hash, so the large classes do not drown the rare Critical ones. |
| 7 | Store the cleaned copy so a rerun picks it up directly | Done | `data/complaints_description_only_cleaned.csv` and its manifest (hashes, counts, rules) are committed; the raw workbook never is. Use the committed file instead of reopening the source. |
| 8 | A rubric for labelling complaints by humans, after checking whether rules are already defined elsewhere | Partly done | The rubric (v0.3) is written with decision rules and examples, and the same file drives the LLM prompt. The check against any existing rules is still open and listed as an open item in `labelling/rubric.json`. |

### Also done beyond the checklist

**1. LLM labelling of all 58,640 complaints** (`labelling/`). The original labels were inconsistent on several themes, so the rubric was applied by LLM APIs on free tiers.

| Piece of work | Amount |
| --- | --- |
| Complaints labelled | **58,640** (every row of the cleaned dataset), each with a label, an "unclear" flag and a short reason |
| Pilot on a random 500 | about 7 requests; 61.6% exact agreement with the original labels |
| Random 2,000 sample (the fairest check) | 2,000 complaints, 25 requests of 80; 62.2% exact, 93.7% within one level, Cohen's kappa 0.46 (weighted 0.63) |
| Second provider tried | 90-row test (54.5% agreement) and about 350 rows of the 2,000; far slower because of its token-per-minute limit, so only a few hundred rows of the final file came from it |
| First full pass, in file order | about 19.7k complaints before the free daily quota stopped it; that sample was skewed (the file is sorted by label), so it was not used as a measurement |
| Final full pass | the remaining ~39k complaints, 100 per request, split into row ranges and run in parallel on five separate keys; one missed row was labelled separately |
| Total API requests | roughly 700 (an estimate; per-request counts were not logged) |
| Cleanup | 2,100 duplicate rows from accidental concurrent runs removed; every one of the 58,640 ids checked to appear exactly once with a valid label |
| Models used | two small, fast "flash-lite" models of one family for almost all rows (the first ~19k by one version, most of the rest by the next), plus a few hundred rows from a second provider's model; the model per row was not recorded |
| Result | Low 12,967, Medium 22,593, High 16,938, Critical 6,142; 60.5% exact and 92.6% within one level against the original labels; the LLM calls about 44% more complaints Critical than the original labels do |

Supporting work: a labelling engine (batching, resume, retries, quota handling, row-range splitting, several keys, a list of ids to redo), a labelling notebook, a review of how the original labels relate to complaint themes, and three rubric versions (v0.1, v0.2, v0.3).

**2. Training and retraining** (`training/`, `model/`). The model was retrained on the LLM labels instead of the original ones, description only.

| Item | Detail |
| --- | --- |
| Data | the 58,640 LLM-labelled complaints; **5-fold stratified cross-validation** (every complaint is scored once by a model that did not train on it), then a final model trained on all rows. The first version used a single stratified 80/10/10 split (46,912 / 5,864 / 5,864) |
| Features | text cleaned the same way at training and serving, then a 384-number sentence embedding from `paraphrase-multilingual-MiniLM-L12-v2` (handles English and Tamil); no complaint type |
| Classifier | CatBoost multiclass, depth 6, learning rate 0.1, L2 5, `SqrtBalanced` class weights (Critical is ~10% of rows) |
| Packaged model | the final model: 2,181 trees on a GPU, trained on all 58,640 rows (tree count = the folds' mean best iteration, 1,982, plus 10%); saved as `.cbm` and pickle with a label map, metrics and a standalone predictor class |
| Its cross-validation result against the LLM labels (mean of 5 folds, ± spread) | accuracy 78.1% (±0.2), macro F1 76.1% (±0.2), quadratic kappa 0.758, within one level 94.9%, Critical recall 62.6% (±1.3); per-class F1: Low 80.3%, Medium 80.2%, High 77.6%, Critical 66.4% |
| Earlier version it replaced | single split, CPU, 300 trees: accuracy 75.4%, macro F1 73.4%, Critical recall 61.6% on one 10% test (not directly comparable, since it used a single split) |
| Retraining tools | a Colab notebook with **5-fold stratified cross-validation** (then a final model on all rows, with the tree count taken from the folds) and a local script; both stop or warn if there is no GPU. The packaged model is the output of the 5-fold GPU run. |

**3. Serving and checking**
- **API with Swagger** (`app/`): single and batch scoring, health, optional API key, `needs_review` flag; 7 API tests.
- **Older model kept** (`older_severity_model/`): moved with history intact; its service and 7 tests still pass.
- **Critical-miss measurement**: found that the model misses 38.4% of Critical complaints (236 of 614 on the test set) and measured how many a probability threshold and a keyword rule list would catch at what alarm rate (`training/critical_recall_analysis.py`, `model/critical_rules.json`).

**4. Making it repeatable**
- **Iterative pipeline** (`labelling/pipeline.py`): runs with records, comparison, targeted reruns, human review, promotion; 7 tests; the first full pass registered as `run-001-initial`.
- **Docs**: this README (including the step-by-step improvement guide), `ITERATIONS.md`, and the labelling and training READMEs.

**Still open:** a small independently human-labelled test set, a Tamil-speaker review of the danger-phrase rules, and wiring the Critical safety net into the API.

## Quick start: run the API

Requires Python 3.11 or newer.

```bash
cd severity-service
pip install -r requirements-dev.txt
python -m uvicorn app.main:app --port 8000
```

Wait for `Application startup complete` (the model loads in 10 to 20 seconds), then open **http://localhost:8000/docs** for Swagger. The command must be run from the `severity-service` folder.

```bash
curl -X POST http://localhost:8000/severity -H "Content-Type: application/json" \
  -d '{"complaint_id":"C-1","description":"Open manhole on the main road near the school, children could fall in"}'
```

```json
{"complaint_id":"C-1","severity":"Critical","severity_id":3,"confidence":0.9555,
 "probabilities":{"Low":0.0035,"Medium":0.0127,"High":0.0283,"Critical":0.9555},
 "needs_review":false,"model_version":"catboost_desc_only-cv5-2026-11-08"}
```

| Endpoint | Purpose |
| --- | --- |
| `POST /severity` | Score one complaint: `{"complaint_id": "...", "description": "..."}` (`description` is required, `complaint_id` is echoed back) |
| `POST /severity/batch` | Score `{"items": [...]}`, up to 256 per call |
| `GET /health` | Liveness, model version, review threshold |

`needs_review` is true when the top probability is below 0.6, which marks answers a person should check. Only `description` is used; other fields in the request (such as a complaint type) are accepted and ignored. Errors: `422` for a missing or empty description or an empty batch, `413` for a batch over the limit, `401` for a wrong key when authentication is on.

**Settings** (environment variables, prefix `SEVERITY_`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEVERITY_MODEL_DIR` | `model/` | Folder with the model bundle |
| `SEVERITY_REVIEW_THRESHOLD` | `0.6` | Below this confidence, `needs_review` is true |
| `SEVERITY_MAX_BATCH_SIZE` | `256` | Largest accepted batch |
| `SEVERITY_API_KEY` | unset | When set, `/severity*` requires an `X-API-Key` header (use "Authorize" in Swagger); `/health` stays open |

Run the tests with `pytest tests` (14 tests: the API and the labelling pipeline).

## Use the model without the API

The bundle in `model/` is self-contained. Copy the folder, then:

```python
# pip install catboost sentence-transformers
from severity_predictor import SeverityModel
model = SeverityModel("model")                       # folder with severity_catboost.cbm and label_map.json
model.predict(["Street dog bit a child this morning"])
# [{'severity': 'Critical', 'severity_id': 3, 'confidence': 0.96, 'probabilities': {...}}]
```

The `.cbm` file is a CatBoost multiclass model whose input is 384 normalised sentence-embedding values (`e0` to `e383`) produced by `paraphrase-multilingual-MiniLM-L12-v2` (named in `label_map.json`). The predictor applies the same text cleaning that was used in training: HTML entities and markup removed, whitespace collapsed, template ids and phone numbers stripped.

## Severity levels

| Level | Meaning (short) |
| --- | --- |
| Critical | Danger to life or serious injury: someone hurt or attacked, a bite, electric shock, fire, an open drain or manhole people could fall into, something about to fall |
| High | Significant health or hygiene risk, or loss of an essential service for an area, with no injury described: standing water, sewage overflow, no drinking water, mosquito breeding |
| Medium | A real inconvenience with limited risk: street light off, garbage not collected, a pothole, stray animals present |
| Low | Minor, cosmetic, regulatory or request-type: encroachment, unauthorised boards, tax or certificate queries, new facilities |

The full rubric, with decision rules for the borderline cases (dogs, open hazards, water, road damage, street lights, garbage, cattle) and examples, is in `labelling/rubric.json`.

## Data

`data/complaints_description_only_cleaned.csv` has `complaint_id` (an opaque new id), `description` (complaint text with personal data removed) and `label` (the original severity label). Building it: personal data removed (emails, phone numbers, links, identity numbers, complaint references, name-plus-address combinations), near-duplicate descriptions removed with location-insensitive matching, texts with conflicting labels dropped, and at most 20,000 rows kept per label by a stable content hash. The raw workbook is never committed. The manifest next to the CSV records counts and hashes so a rebuild can be audited. Note the file is sorted by label, so take random samples, never the first N rows.

## Labelling

The original labels were not written from a documented rubric and are inconsistent on several themes, so a rubric was written (`labelling/rubric.json`) and the data was relabelled with an LLM using the prompt generated from it. The labelling is built to be repeated:

- Every pass is a **run** with a record of the rubric version, prompt hash and model.
- Runs can be **compared**, and **partly redone** (only the unclear rows, or where two passes disagree).
- Doubtful rows are exported for **human review**, whose decisions override every model label.
- A **promote** step builds the label file used for training and records how it was built.

```bash
python labelling/pipeline.py status
python labelling/pipeline.py label --run-id r2 --model gemini-3.1-flash-lite --batch-size 100
python labelling/pipeline.py report r2
python labelling/pipeline.py review-export --run r2 --select disagree-source --limit 300
python labelling/pipeline.py promote r2 --reviews labelling/review/r2_disagree-source.csv
```

The labelling engine needs an API key for a supported free-tier LLM provider (`--provider gemini` or `groq`) in `labelling/.env` (copy `labelling/.env.example`; the file is git-ignored). Details, the loop, provider limits, experiments and results are in `labelling/README.md`.

## Training

`training/severity_train_catboost.ipynb` trains the model on `labelling/output/llm_labels.csv`:

1. Clean the text and embed it with the multilingual sentence-transformer (a GPU runtime is strongly recommended; the notebook stops early with a message if none is attached).
2. **5-fold stratified cross-validation**: five models, each scored on the fold it never saw, so every complaint gets one out-of-fold prediction. Reports per-fold and mean results, a per-class report and a confusion matrix.
3. Train the final model on all rows, with the number of trees taken from the folds.
4. Save `severity_catboost.cbm`, a pickle, `label_map.json`, `metrics.json` and `severity_predictor.py`, and zip them.

Parameters: multiclass loss, `auto_class_weights="SqrtBalanced"` (Critical is only about 10% of the rows), depth 6, learning rate 0.1, L2 regularisation 5, up to 2,000 trees with early stopping on 10% of each fold's training part. `training/train_description_only.py` is the same idea as a local script with a single stratified split. To use a newly trained model, copy its files into `model/` and restart the API.

## Improving it iteratively: what to do

Work in small rounds. Each round changes **one thing**, measures it against the same yardstick, and records the result in `ITERATIONS.md`. The levers, from cheapest to most expensive:

| Lever | When it helps | Where |
| --- | --- | --- |
| 1. Clearer rubric | The labels disagree on a theme because the rule is vague | `labelling/rubric.json` |
| 2. Better labels | Labels are noisy or one-sided (for example too many Critical) | `labelling/pipeline.py` (relabel, review, promote) |
| 3. Better data | Some kinds of complaint are rare or missing | `data/`, `scripts/` |
| 4. Model settings | Labels are good but the model underfits or overfits | `training/` |
| 5. Decision rule | The model is fine but too many or too few answers are flagged for review | `app/config.py` (`review_threshold`) |

### One round, step by step

1. **Set up and check the baseline.** Install the requirements, run `pytest tests`, and run `python labelling/pipeline.py status`. Note the current model metrics in `model/metrics.json` and the last row of `ITERATIONS.md`.
2. **Find where it is wrong.** Open the confusion matrix in the training notebook's output (or `metrics.json`), then read real mistakes: `python labelling/pipeline.py review-export --run <run> --select disagree-source --limit 200` writes a CSV of complaints where the labels disagree. Group them into themes (for example "dog complaints without a bite", "potholes where nobody was hurt"). Pick **one** theme or one weak class to fix this round.
3. **Make the change for that lever.**
   - *Rubric:* edit `labelling/rubric.json` (add or tighten a decision rule or an example), bump `version`, run `python labelling/build_prompt.py`, then `python labelling/pipeline.py status` shows every old run as stale.
   - *Labels:* start a new run (`pipeline.py label --run-id <new> --model <model>`), or redo only the affected rows as an overlay (`--select disagree-with:<run>` or `--select unclear --base-run <run>`). Try it on `--sample 500` first and run `report` and `compare` against the previous run before spending a full pass.
   - *People in the loop:* `review-export`, fill `reviewed_label` in the CSV, then `promote <run> --overlay <redo-run> --reviews <csv>`. Human decisions beat model labels.
   - *Data:* rebuild with `scripts/prepare_description_only_data.py` (never commit the raw workbook), check the new manifest hashes, and register new labels as a run.
   - *Model settings:* change parameters in the training notebook (depth, learning rate, class weights, trees, or a different multilingual encoder; a new encoder means retraining and updating `label_map.json`).
4. **Retrain.** Run `training/severity_train_catboost.ipynb` on a GPU runtime (5-fold cross-validation, then a final model on all rows). Keep the whole `severity_model/` bundle it produces.
5. **Judge the result with the same yardstick.**
   - Compare the cross-validation **mean macro F1**, **Critical recall** and **within-one-level** with the previous row of `ITERATIONS.md`; the per-fold spread tells you whether a gain is real or noise.
   - **Do not compare scores across different label versions as if they were the same test**: changing the labels changes what is being predicted. Keep a small test set labelled independently by people (two labellers and a tie-breaker, rubric only; see `labelling/README.md`) and score every candidate model on it. That set is the only fair yardstick across iterations.
   - Look at `needs_review`: tune `review_threshold` from the out-of-fold probabilities (accuracy against the share of answers flagged).
6. **Keep it only if it is better.** Better means the target metric moved by more than the fold-to-fold spread and nothing important got worse (especially Critical recall). Otherwise discard the round and write down why in `ITERATIONS.md`; a failed experiment is still a result.
7. **Ship it.** Copy the bundle into `model/`, update the default `model_version` in `app/config.py`, run `pytest tests`, start the API and check `/health` shows the new version and a few known complaints behave sensibly.
8. **Record and review.** Add a row to `ITERATIONS.md` (what changed, run ids, rubric version, metrics, decision) and open a change that includes: the rubric diff (if any), the new run manifests and reports, review files, promoted labels and manifest, the new model bundle, and the updated log.

### Rules that keep rounds comparable

- One change per round, so a gain or a loss has one explanation.
- One model and one rubric version per labelling run; a changed rubric means a new run id.
- Never take "first N rows" of the data: it is sorted by label. Use `--sample` or a seeded random split.
- Never train on labels from the set you test on, and never use model-written labels as the final test set.
- Do not commit keys, the raw workbook, or large per-run label files (the `.gitignore` files already exclude them).
- Run one labelling command per output file (or split by `--start/--end`) so labels are not duplicated.

## Results and limits

| What | Value |
| --- | --- |
| Model, 5-fold cross-validation over all 58,640 complaints, against the LLM labels | accuracy 78.1%, macro F1 76.1%, quadratic kappa 0.758, within one level 94.9%, Critical recall 62.6% (fold-to-fold spread of Critical recall: ±1.3 points) |
| LLM labels against the original labels (all 58,640 rows) | 60.5% exact, 92.6% within one level; the LLM labels more complaints Critical (6,142 against 4,275) |
| LLM labels against the original labels (random 2,000) | 62.2% exact, Cohen's kappa 0.46 (weighted 0.63) |

- The model's scores measure how well it **reproduces the LLM labels**, not true severity. Neither the LLM labels nor the original labels have been checked by people, and they agree only about 60% of the time, so treat this as a first model.
- The packaged model is the final model of the 5-fold GPU run. The folds stopped at 1,945 to 1,998 trees, close to the 2,000-tree limit, so more trees could add a little. Cross-validation measures how well it reproduces the LLM labels on complaints it did not train on; the final model itself saw every row, so it has no separate held-out test set.
- For an honest measurement, build a small test set labelled independently by people (two labellers plus a tie-breaker, using only the rubric) and never use model-written labels as the test set; the process is in `labelling/README.md`.

### When the model misses a Critical complaint

Missing a Critical complaint is the costliest mistake, so this was measured on the **earlier single-split model's** held-out test set (5,864 complaints, 614 of them Critical; "Critical" here means labelled Critical in `labelling/output/llm_labels.csv`).

**For the current model**, cross-validation gives Critical recall of 62.6%, so about 37% of Critical complaints are still missed, almost the same as below. The table below was measured on the earlier single-split model, because the current model saw every row in training and has no held-out set.

**What happens today.** Nothing special: the API returns the model's own answer, so a missed Critical complaint is handled like any other complaint of the severity it was given.

| Of the 614 Critical complaints | Result |
| --- | --- |
| Model says Critical | 378 (61.6%) |
| **Missed** | **236 (38.4%)**: called High 132, Medium 70, Low 34 |
| Chance the model gave to Critical on the misses | median 0.20; at least 0.10 for 79% of them; under 0.05 for only 7% |
| Misses already flagged `needs_review` (confidence below 0.6) | 60%; the other 40% went through with no warning |

So the model usually suspects a Critical case but does not commit to it. Examples it missed: a street-light pole that had fallen (answered Medium), drain water flowing back into a house (High), and red worms in the drinking-water supply (High).

**What a safety net could catch.** Two cheap signals were measured: an alert when the model's probability of Critical is at least a threshold, and a keyword rule list (`model/critical_rules.json`: animal bites, electric shock or live wires, fire or smoke, uncovered manholes or drains, things about to fall, sewage in drinking water or homes, outbreak wording, gas leaks, "dangerous" wording, plus a few Tamil terms). On the same test set:

| Alert when P(Critical) is at least | Share of Critical complaints caught | Share of all complaints that raise an alert |
| --- | --- | --- |
| model answer only (argmax) | 61.6% | 9.9% |
| keyword rules alone | 65.6% | 15.4% |
| 0.20 + rules | 91.5% | 26.5% |
| 0.15 + rules | 95.0% | 31.2% |
| 0.10 + rules | 96.3% | 38.8% |
| 0.06 + rules | 98.0% | 49.2% |
| 0.04 + rules | 99.2% | 57.3% |
| 0.02 + rules | 99.8% | 71.6% |

Catching nearly every Critical complaint means raising an alert on far more complaints than are actually Critical, and **a statistical model cannot guarantee zero misses**. A workable design is two levels: a precise rule (such as electric shock or something falling) returns Critical outright, and anything above a lower threshold raises a "possible Critical, a person should check" alert while the model's own answer is still returned; any error or unreadable text should go to a person, never default to Low.

**Status: measured, not built into the API.** The API currently returns the model's answer unchanged and raises no Critical alert. What exists:

- `model/critical_rules.json`: the editable keyword rules (case-insensitive regular expressions, each tagged `confirmed` or `possible`).
- `training/critical_recall_analysis.py`: reproduces the earlier model's test split, scores the packaged model and prints the table above (**the current model trained on those rows, so rerunning it now would flatter the result (it shows about 95% Critical recall on rows the model trained on, against 62.6% in cross-validation, so do not quote it); to re-measure honestly, save the cross-validation out-of-fold probabilities in the notebook and use those**) (`python training/critical_recall_analysis.py`). Rerun it after retraining or editing the rules.

Limits of these numbers: "Critical" is the LLM label, not a human-verified emergency; the rules were refined after reading this test set's misses, so their measured recall is optimistic; and the Tamil rules use basic common words that a Tamil speaker should check and extend. Re-measure on a human-labelled set when one exists.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No module named app` | Run `uvicorn` from the `severity-service` folder |
| Port 8000 already in use | Use `--port 8001`, or stop the other server |
| Slow first start | The encoder is loaded (and downloaded the first time); set `HF_HUB_OFFLINE=1` afterwards to skip network checks |
| Labelling stops with a quota message | Free tiers have daily limits; rerun the same command later, it resumes |
| Several copies of the labelling command writing one run | Run one copy per output file, or split by `--start/--end` |
| Excel holds a CSV open and a git operation fails | Close the file in Excel and retry |
