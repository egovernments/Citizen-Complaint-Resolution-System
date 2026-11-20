import logging
from contextlib import asynccontextmanager

import secrets

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from .config import settings
from .predictor import SeverityPredictor
from .schemas import (
    BatchRequest,
    BatchResponse,
    HealthResponse,
    SeverityRequest,
    SeverityResponse,
)

logging.basicConfig(level=logging.INFO)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(key: str | None = Security(_api_key_header)) -> None:
    expected = settings.api_key
    if expected and not (key and secrets.compare_digest(key, expected)):
        raise HTTPException(401, "Invalid or missing X-API-Key")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.predictor = SeverityPredictor(settings)
    yield


app = FastAPI(
    title="CCRS Severity Service",
    description="Predicts complaint severity (Low / Medium / High / Critical) from the "
    "description and complaint type, using a multilingual sentence embedding + CatBoost.",
    version="1.0.0",
    lifespan=lifespan,
)


def _score(request: Request, reqs: list[SeverityRequest]) -> list[SeverityResponse]:
    predictor: SeverityPredictor = request.app.state.predictor
    preds = predictor.predict([(r.description, r.complaint_type) for r in reqs])
    return [
        SeverityResponse(complaint_id=r.complaint_id, model_version=settings.model_version, **p)
        for r, p in zip(reqs, preds)
    ]


@app.post("/severity", response_model=SeverityResponse, tags=["severity"], dependencies=[Depends(require_api_key)])
def predict_severity(body: SeverityRequest, request: Request):
    return _score(request, [body])[0]


@app.post("/severity/batch", response_model=BatchResponse, tags=["severity"], dependencies=[Depends(require_api_key)])
def predict_severity_batch(body: BatchRequest, request: Request):
    if len(body.items) > settings.max_batch_size:
        raise HTTPException(413, f"Batch too large (max {settings.max_batch_size})")
    return BatchResponse(results=_score(request, body.items))


@app.get("/health", response_model=HealthResponse, tags=["ops"])
def health(request: Request):
    if getattr(request.app.state, "predictor", None) is None:
        raise HTTPException(503, "model not loaded")
    return HealthResponse(
        status="UP",
        model_version=settings.model_version,
        critical_threshold=settings.critical_threshold,
        review_threshold=settings.review_threshold,
    )
