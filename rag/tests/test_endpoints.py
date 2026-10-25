from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import Chunk, DecisionSummary, IntentSpec


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ingest_endpoint(client: TestClient) -> None:
    payload = {
        "proposalId": "MIP-17",
        "files": [
            {"type": "forum", "path": "data/scenarios/MIP-17/forum_thread.json"},
            {"type": "pdf", "path": "data/scenarios/MIP-17/proposal.pdf"},
            {"type": "social", "path": "data/scenarios/MIP-17/social.json"},
            {"type": "onchain", "path": "data/scenarios/MIP-17/onchain_actions.json"},
        ],
    }
    resp = client.post("/ingest", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    chunks = [Chunk.model_validate(c) for c in data]
    assert chunks[0].proposalId == "MIP-17"
    assert chunks[0].sha256.root.startswith("0x")


def test_summarize_endpoint(client: TestClient) -> None:
    resp = client.post("/summarize", json={"proposalId": "MIP-21"})
    assert resp.status_code == 200
    data = resp.json()
    summary = DecisionSummary.model_validate(data)
    assert summary.proposalId == "MIP-21"
    assert len(summary.claims) > 0
    assert len(summary.risks) > 0


def test_extract_intent_endpoint(client: TestClient) -> None:
    resp = client.post("/extract-intent", json={"proposalId": "MIP-21"})
    assert resp.status_code == 200
    data = resp.json()
    intent = IntentSpec.model_validate(data)
    assert intent.proposalId == "MIP-21"
    assert len(intent.actions) > 0
    assert "change to ownership" in intent.explicitlyExcluded


def test_search_endpoint(client: TestClient) -> None:
    resp = client.post("/search", json={"proposalId": "MIP-21", "query": "ownership", "k": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    chunks = [Chunk.model_validate(c) for c in data]
    assert len(chunks) <= 3


def test_explain_endpoint(client: TestClient) -> None:
    payload = {
        "proposalId": "MIP-21",
        "findings": [
            {"id": "f1", "said": "No change to ownership", "does": "MeridianReserve owner changes"}
        ],
    }
    resp = client.post("/explain", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "headline" in data
    assert "paragraph" in data
    assert len(data["perFinding"]) == 1


def test_get_chunk_by_id(client: TestClient) -> None:
    resp = client.get("/chunks/MIP-21:forum:0")
    assert resp.status_code == 200
    chunk = Chunk.model_validate(resp.json())
    assert chunk.id == "MIP-21:forum:0"

    resp_404 = client.get("/chunks/MIP-21:nonexistent:99")
    assert resp_404.status_code == 404
    assert resp_404.json()["error"]["code"] == "NOT_FOUND"
