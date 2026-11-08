# Training

Training for the description-only severity model. The earlier model (description + complaint type, `PGR_SentenceTransformer_CatBoost.ipynb`)
and its service were moved to `../older_severity_model/`.

## Description-only model on the LLM labels

Trains on `labelling/output/llm_labels.csv` (complaint description -> Low / Medium / High / Critical, no complaint type),
using the same `paraphrase-multilingual-MiniLM-L12-v2` embeddings and a CatBoost classifier. The earlier model is kept under
`../older_severity_model/`.

- **`severity_train_catboost.ipynb`**: run it live on Colab (Runtime -> T4 GPU). It loads the CSV from GitHub (or asks you to
  upload it), embeds the text, runs **5-fold stratified cross-validation** (every complaint is scored once by a model that never trained on it;
  mean and spread across folds, plus out-of-fold confusion matrix), trains the final model on all rows with the tree count taken from
  the CV, and saves `severity_model/` (`severity_catboost.cbm`, `severity_catboost.pkl`, `label_map.json`, `severity_predictor.py`, `metrics.json`)
  and a zip of it.
- **`severity_predictor.py`**: standalone class for other systems: `SeverityModel("severity_model").predict([text, ...])`
  returns severity, confidence and class probabilities. Needs only `catboost` and `sentence-transformers`.
- **`train_description_only.py`**: the same training as a plain script for a local run (`python training/train_description_only.py`);
  writes to `model/description_only/` and also reports agreement with the original source labels.

Parameters (4 classes, Critical about 10% of the data): MultiClass loss, `auto_class_weights="SqrtBalanced"`, depth 6, learning rate 0.1,
L2 5, up to 2,000 trees with early stopping on 10% of each fold's training part. (`train_description_only.py` uses a single
stratified 80/10/10 split instead of cross-validation.)
The labels were written by an LLM, so the scores measure how well the model reproduces those labels, not true severity.

After every retraining, compare the cross-validation results with the previous round and record them in `../ITERATIONS.md`; the steps are in "Improving it iteratively" in `../README.md`.
