# Training

`PGR_SentenceTransformer_CatBoost.ipynb` trains the severity model: complaint text is cleaned
(`app/preprocess.py`), embedded with `paraphrase-multilingual-MiniLM-L12-v2` and, together with the complaint
type, fed to a CatBoost multiclass classifier (Low / Medium / High / Critical).

The training data (GCC Chennai PGR complaints, FY 2024-25) is **not** in this repository. The notebook
reads a labelled CSV (`DATA_CSV`) that you must supply. The result is `model/catboost_pgr.cbm`.
After retraining, regenerate the browser model with `python scripts/export_static_model.py`.
