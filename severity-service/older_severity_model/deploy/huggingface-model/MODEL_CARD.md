---
license: other
library_name: catboost
tags:
  - catboost
  - text-classification
  - complaint-severity
  - sentence-transformers
pipeline_tag: text-classification
---

# CCRS complaint severity model

CatBoost multiclass classifier that scores a citizen complaint as **Low / Medium / High / Critical**
(`0..3`, see `label_map.json`).

## Inputs
Columns, in this order:
1. `e0` … `e383`: embedding of the cleaned complaint text from
   `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (`max_seq_length=128`,
   `normalize_embeddings=True`). Clean the text with `text_for_model()` in `preprocess.py` first.
2. `ctype`: PGR complaint type display name (a string; the 183 training values are in `ctype_values.json`).

## Usage
```python
from catboost import CatBoostClassifier
from huggingface_hub import hf_hub_download
from sentence_transformers import SentenceTransformer
import pandas as pd
from preprocess import text_for_model   # downloaded from this repo

repo = "<user>/<repo>"
model = CatBoostClassifier().load_model(hf_hub_download(repo, "catboost_pgr.cbm"))
enc = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
enc.max_seq_length = 128
E = enc.encode([text_for_model("Stray dogs attacking children")], normalize_embeddings=True)
X = pd.DataFrame(E, columns=[f"e{i}" for i in range(384)]); X["ctype"] = "Street Dogs"
print(model.predict_proba(X))   # columns: Low, Medium, High, Critical
```

Serving code: `backend/severity-service` in the CCRS repo. The service also returns "Critical" whenever
P(Critical) ≥ 0.5, because recall for Critical at plain argmax is low (~0.54).
