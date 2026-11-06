# severity-service

Predicts complaint severity (`Low` / `Medium` / `High` / `Critical`) from the complaint
description and PGR complaint type. FastAPI + `paraphrase-multilingual-MiniLM-L12-v2`
embeddings + CatBoost (`model/catboost_pgr.cbm`).

## Run

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --port 8000        # Swagger UI: http://localhost:8000/docs
pytest tests                            # first run downloads the encoder
```

Docker (encoder is baked into the image): `docker compose -f local-setup/docker-compose.yml up --build severity-service`
→ Swagger at http://localhost:18150/docs.

## Free Hugging Face deploy (no Docker, no server)

A Static Space runs the model in the visitor's browser (`static-space/`; verified identical to the API).

```bash
HF_TOKEN=hf_xxx python scripts/deploy_static_space.py <user>/ccrs-severity-app   # public (a private static Space returns 401 for its own files)
```

Re-export the model with `python scripts/export_static_model.py` if `model/catboost_pgr.cbm` changes.
This is a browser app, not an HTTP API: `pgr-services` cannot call it. Use the FastAPI service for that.

## Publish the model to a Hugging Face model repo

```bash
HF_TOKEN=hf_xxx python deploy/huggingface-model/upload_model.py <user>/ccrs-severity-model   # private; add --public to open it
```

Uploads `catboost_pgr.cbm`, the label map, the complaint-type list, `preprocess.py` and a model card.

## Deploy to Hugging Face Spaces

```bash
HF_TOKEN=hf_xxx bash deploy/huggingface/deploy.sh <user-or-org>/ccrs-severity   # private Space; add "public" to open it
```

Needs `git` + `git-lfs` and a write token. It creates a Docker Space, pushes the service (the
model goes through LFS) and Spaces builds the image. Then, in the Space's Settings → Variables and
secrets, add a secret `SEVERITY_API_KEY`; with it set, `/severity*` requires an `X-API-Key` header
(use "Authorize" in Swagger). Health stays open. The first build takes several minutes.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /severity` | Score one complaint |
| `POST /severity/batch` | Score `{"items": [...]}` (max 256) |
| `GET /health` | Liveness + active thresholds |

Request: `{"complaint_id", "description", "complaint_type"}` where `complaint_type` is the PGR
display name (`COMPLAINTTYPENAME`, e.g. `Street Dogs`), not a service code. Omitted → `Others`.
Response: `severity`, `severity_id`, `confidence`, `probabilities`, `needs_review`, `model_version`.

## Behaviour

- `Critical` is returned whenever P(Critical) ≥ `SEVERITY_CRITICAL_THRESHOLD` (default 0.5), even if
  it is not the top class — the model's Critical recall at plain argmax is only ~0.54.
- `needs_review` is true when the returned severity's probability < `SEVERITY_REVIEW_THRESHOLD` (0.6).
- Text goes through `app/preprocess.py` (identical to training) before embedding; do not change it
  without retraining.

Config env vars (prefix `SEVERITY_`): `CRITICAL_THRESHOLD`, `REVIEW_THRESHOLD`, `MODEL_VERSION`,
`ENCODER_PATH`, `MODEL_PATH`, `API_KEY`, `DEFAULT_CTYPE`, `MAX_BATCH_SIZE`.

`model/ctype_values.json` lists the 183 complaint types seen in training. Unseen types still score
(CatBoost treats them as an unknown category) but with less reliable results.
