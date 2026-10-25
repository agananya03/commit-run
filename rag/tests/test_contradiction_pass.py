from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import DecisionSummary, Support
from app.services.contradiction_detector import collect_numeric_statements, detect_contradictions
from app.services.db import get_chunks_for_proposal, get_chunk_by_id


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_collect_numeric_statements_and_detect_contradictions(client: TestClient) -> None:
    # 1. Ingest MIP-17 files
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

    chunks = get_chunks_for_proposal("MIP-17")
    assert len(chunks) > 0

    # 2. Test collection of numeric statements
    statements = collect_numeric_statements(chunks)
    assert len(statements) > 0
    val_types = {s.val_type for s in statements}
    assert "amount" in val_types
    assert "date" in val_types

    # Verify statement fields
    for s in statements:
        assert s.chunk_id
        assert s.quote
        assert s.val_str

    # 3. Test detection of contradictions
    contradictions = detect_contradictions("MIP-17", chunks)
    assert len(contradictions) >= 2

    # Check that both contradictions are present
    budget_contradiction = None
    date_contradiction = None
    for c in contradictions:
        assert c.support == Support.contradicted
        assert c.pSupported == 0.05
        assert len(c.citations) >= 2

        if "3,500,000" in c.text or "5,000,000" in c.text or "allocation" in c.text:
            budget_contradiction = c
        if "milestone" in c.text.lower() or "march 31" in c.text.lower() or "may 15" in c.text.lower():
            date_contradiction = c

    assert budget_contradiction is not None, "MIP-17 $3.5M vs $5M contradiction not found"
    assert date_contradiction is not None, "MIP-17 milestone date mismatch not found"

    # Verify both citations for each contradiction
    for c in [budget_contradiction, date_contradiction]:
        for cit in c.citations:
            chunk = get_chunk_by_id(cit.chunkId)
            assert chunk is not None
            assert cit.sha256 == chunk.sha256
            assert cit.sourceUri == chunk.sourceUri
            # Quote must match chunk text
            assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split())


def test_summarize_emits_contradictions_as_claims(client: TestClient) -> None:
    # Test that /summarize endpoint emits the contradiction claims
    resp = client.post("/summarize", json={"proposalId": "MIP-17"})
    assert resp.status_code == 200
    summary = DecisionSummary.model_validate(resp.json())

    contradiction_pass_claims = [c for c in summary.claims if c.id.startswith("con_")]
    assert len(contradiction_pass_claims) >= 2

    has_budget = any("3,500,000" in c.text or "5,000,000" in c.text or "allocation" in c.text for c in contradiction_pass_claims)
    has_date = any("milestone" in c.text.lower() or "march 31" in c.text.lower() or "may 15" in c.text.lower() for c in contradiction_pass_claims)

    assert has_budget, "Summary claims must contain $3.5M vs $5M contradiction"
    assert has_date, "Summary claims must contain milestone date mismatch"

    for c in contradiction_pass_claims:
        assert c.support == Support.contradicted
        assert c.pSupported == 0.05
        assert len(c.citations) >= 2
