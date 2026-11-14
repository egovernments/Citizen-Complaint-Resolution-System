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

Docker (encoder is baked into the image): `docker build -t severity-service:local severity-service/`, or enable it in the
local-setup Ansible stack with `enable_severity: true` (see `local-setup/ansible/README.md`). In the stack it listens on
internal port 8000 only — no published port, no nginx route. Reach it as `http://severity-service:8000` from other
containers, or `docker exec severity-service python -c "..."`.

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
