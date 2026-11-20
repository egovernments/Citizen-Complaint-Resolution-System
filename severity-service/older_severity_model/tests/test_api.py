import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.preprocess import text_for_model


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_text_for_model_strips_template_ids_and_phones():
    raw = "Street light off 2024-297EJL call +91 98765 43210&#13;@Anna Nagar"
    assert text_for_model(raw) == "Street light off call"


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "UP"


def test_single(client):
    r = client.post(
        "/severity",
        json={"complaint_id": "X1", "description": "Stray dogs attacking children", "complaint_type": "Street Dogs"},
    )
    assert r.status_code == 200
    b = r.json()
    assert b["complaint_id"] == "X1"
    assert b["severity"] == ["Low", "Medium", "High", "Critical"][b["severity_id"]]
    assert abs(sum(b["probabilities"].values()) - 1) < 0.01


def test_missing_and_unknown_type(client):
    assert client.post("/severity", json={"description": "garbage not collected"}).status_code == 200
    r = client.post("/severity", json={"description": "x", "complaint_type": "Never seen type"})
    assert r.status_code == 200


def test_critical_threshold_override(client):
    pred = app.state.predictor
    old = pred.cfg.critical_threshold
    pred.cfg.critical_threshold = 0.0  # P(Critical) >= 0 always
    try:
        r = client.post("/severity", json={"description": "garbage", "complaint_type": "Others"})
        assert r.json()["severity"] == "Critical"
    finally:
        pred.cfg.critical_threshold = old


def test_batch(client):
    items = [{"description": "pothole on road"}, {"description": "no water supply"}]
    r = client.post("/severity/batch", json={"items": items})
    assert r.status_code == 200 and len(r.json()["results"]) == 2
    assert client.post("/severity/batch", json={"items": []}).status_code == 422


def test_api_key_enforced_when_configured(client):
    from app.config import settings

    settings.api_key = "s3cret"
    try:
        body = {"description": "garbage not collected"}
        assert client.post("/severity", json=body).status_code == 401
        assert client.post("/severity", json=body, headers={"X-API-Key": "nope"}).status_code == 401
        assert client.post("/severity", json=body, headers={"X-API-Key": "s3cret"}).status_code == 200
        assert client.get("/health").status_code == 200  # health stays open for probes
    finally:
        settings.api_key = None
