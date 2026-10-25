from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import Chunk


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_ingest_mip17_scenarios(client: TestClient) -> None:
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
    assert len(data) == 13  # 4 forum + 5 pdf + 3 social + 1 onchain

    chunks = [Chunk.model_validate(c) for c in data]

    # Verify ID format f'{proposalId}:{type}:{n}'
    forum_chunks = [c for c in chunks if c.sourceType.value == "forum"]
    assert len(forum_chunks) == 4
    for i, c in enumerate(forum_chunks):
        assert c.id == f"MIP-17:forum:{i}"
        assert c.sourceUri.startswith("forum://MIP-17/forum_thread.json#post=")
        assert c.sha256.root.startswith("0x")
        assert len(c.sha256.root) == 66

    pdf_chunks = [c for c in chunks if c.sourceType.value == "pdf"]
    assert len(pdf_chunks) == 5
    for i, c in enumerate(pdf_chunks):
        assert c.id == f"MIP-17:pdf:{i}"
        assert c.sourceUri.startswith("pdf://MIP-17/proposal.pdf#page=")
        assert c.page in (1.0, 2.0)
        assert c.sha256.root.startswith("0x")

    social_chunks = [c for c in chunks if c.sourceType.value == "social"]
    assert len(social_chunks) == 3
    for i, c in enumerate(social_chunks):
        assert c.id == f"MIP-17:social:{i}"
        assert c.sourceUri.startswith("social://MIP-17/social.json#msg=")

    onchain_chunks = [c for c in chunks if c.sourceType.value == "onchain"]
    assert len(onchain_chunks) == 1
    assert onchain_chunks[0].id == "MIP-17:onchain:0"
    assert onchain_chunks[0].sourceUri == "onchain://MIP-17/onchain_actions.json#call=0"

    # Also test /chunks/{id} retrieves the chunk
    chunk_resp = client.get("/chunks/MIP-17:pdf:1")
    assert chunk_resp.status_code == 200
    retrieved = Chunk.model_validate(chunk_resp.json())
    assert retrieved.id == "MIP-17:pdf:1"
    assert "1. Executive Summary" in retrieved.text

    # Also test /search filters chunks for MIP-17
    search_resp = client.post("/search", json={"proposalId": "MIP-17", "query": "grant", "k": 5})
    assert search_resp.status_code == 200
    search_chunks = [Chunk.model_validate(c) for c in search_resp.json()]
    assert len(search_chunks) > 0
