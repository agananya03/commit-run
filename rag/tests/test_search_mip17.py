from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import Chunk


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_hybrid_search_mip17_budget_chunks(client: TestClient) -> None:
    # 1. Ingest MIP-17 files first
    ingest_payload = {
        "proposalId": "MIP-17",
        "files": [
            {"type": "forum", "path": "data/scenarios/MIP-17/forum_thread.json"},
            {"type": "pdf", "path": "data/scenarios/MIP-17/proposal.pdf"},
            {"type": "social", "path": "data/scenarios/MIP-17/social.json"},
            {"type": "onchain", "path": "data/scenarios/MIP-17/onchain_actions.json"},
        ],
    }
    ingest_resp = client.post("/ingest", json=ingest_payload)
    assert ingest_resp.status_code == 200
    all_chunks = ingest_resp.json()
    assert len(all_chunks) == 13

    # 2. Search for "how much money is requested"
    search_payload = {
        "proposalId": "MIP-17",
        "query": "how much money is requested",
        "k": 8,
    }
    search_resp = client.post("/search", json=search_payload)
    assert search_resp.status_code == 200

    results = [Chunk.model_validate(c) for c in search_resp.json()]
    assert len(results) > 0
    assert len(results) <= 8

    # All returned chunks must strictly belong to proposalId MIP-17
    for c in results:
        assert c.proposalId == "MIP-17"

    # Must return budget chunks from BOTH the PDF and the forum
    pdf_results = [c for c in results if c.sourceType.value == "pdf"]
    forum_results = [c for c in results if c.sourceType.value == "forum"]

    assert len(pdf_results) > 0, "Expected at least one PDF chunk in top results"
    assert len(forum_results) > 0, "Expected at least one forum chunk in top results"

    # Verify that the PDF result discusses budget/grant amount
    pdf_texts = " ".join(c.text for c in pdf_results)
    assert any(term in pdf_texts for term in ["2,500,000", "USDC", "Budget", "1,000,000"]), (
        f"PDF results did not contain expected budget information: {pdf_texts}"
    )

    # Verify that the forum result discusses grant request amount
    forum_texts = " ".join(c.text for c in forum_results)
    assert any(term in forum_texts for term in ["2,500,000", "USDC", "grant", "treasury"]), (
        f"Forum results did not contain expected budget information: {forum_texts}"
    )

    # Top results should lead with budget/amount discussions
    top_3_text = " ".join(c.text for c in results[:3])
    assert "2,500,000" in top_3_text or "USDC" in top_3_text
