import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "UP"


def test_single(client):
    r = client.post(
        "/severity",
        json={"complaint_id": "X1", "description": "Open manhole near the school, children could fall in"},
    )
    assert r.status_code == 200
    b = r.json()
    assert b["complaint_id"] == "X1"
    assert b["severity"] == ["Low", "Medium", "High", "Critical"][b["severity_id"]]
    assert abs(sum(b["probabilities"].values()) - 1) < 0.01
    assert b["severity"] == "Critical"


def test_extra_fields_are_ignored(client):
    r = client.post("/severity", json={"description": "garbage not collected", "complaint_type": "Garbage"})
    assert r.status_code == 200


def test_validation(client):
    assert client.post("/severity", json={}).status_code == 422
    assert client.post("/severity", json={"description": ""}).status_code == 422


def test_batch(client):
    items = [{"description": "pothole on road"}, {"description": "no water supply"}]
    r = client.post("/severity/batch", json={"items": items})
    assert r.status_code == 200 and len(r.json()["results"]) == 2
    assert client.post("/severity/batch", json={"items": []}).status_code == 422


def test_batch_limit(client):
    old = settings.max_batch_size
    settings.max_batch_size = 1
    try:
        r = client.post("/severity/batch", json={"items": [{"description": "a"}, {"description": "b"}]})
        assert r.status_code == 413
    finally:
        settings.max_batch_size = old


def test_api_key_enforced_when_configured(client):
    settings.api_key = "secret"
    try:
        assert client.post("/severity", json={"description": "x"}).status_code == 401
        ok = client.post("/severity", json={"description": "x"}, headers={"X-API-Key": "secret"})
        assert ok.status_code == 200
        assert client.get("/health").status_code == 200  # health stays open
    finally:
        settings.api_key = None
