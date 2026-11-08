# severity-service

Complaint severity (`Low` / `Medium` / `High` / `Critical`) from the complaint description.

| Folder | What it holds |
| --- | --- |
| `data/` | Cleaned, PII-free complaint data and how it was made (`data/README.md`) |
| `labelling/` | The severity rubric, LLM labelling tool, results and write-up (`labelling/README.md`); final labels in `labelling/output/llm_labels.csv` |
| `training/` | Training for the description-only model (sentence-transformer + CatBoost): Colab notebook with 5-fold cross-validation, a local script, and a standalone predictor class (`training/README.md`) |
| `scripts/` | `prepare_description_only_data.py`, which builds the cleaned dataset |
| `older_severity_model/` | The **previous** model (description + complaint type) with its FastAPI service, tests, Docker and Hugging Face deployment files, and browser version. Kept for reference; it still runs from inside that folder. |

## Run the API (Swagger)

The API serves the description-only model in `model/` (`app/` is the FastAPI service).

```bash
cd severity-service
pip install -r requirements-dev.txt
uvicorn app.main:app --port 8000        # Swagger UI: http://localhost:8000/docs
pytest tests                            # first run may download the encoder
```

| Endpoint | Purpose |
| --- | --- |
| `POST /severity` | Score one complaint: `{"complaint_id": "...", "description": "..."}` |
| `POST /severity/batch` | Score `{"items": [...]}` (max 256) |
| `GET /health` | Liveness and active thresholds |

Response: `severity`, `severity_id`, `confidence`, `probabilities`, `needs_review` (confidence below 0.6), `model_version`.
Only `description` is used; other fields such as a complaint type are ignored. Set `SEVERITY_API_KEY` to require an
`X-API-Key` header on `/severity*` (use "Authorize" in Swagger). Other settings use the `SEVERITY_` prefix
(`SEVERITY_MODEL_DIR`, `SEVERITY_REVIEW_THRESHOLD`, `SEVERITY_MAX_BATCH_SIZE`).
The previous service (description + complaint type) still runs from `older_severity_model/`.
