from __future__ import annotations

import os
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import DecisionSummary, Hex, Support
from app.services.citation_verifier import verify_decision_summary_citations
from app.services.db import get_chunk_by_id


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_summarize_mip17_under_20_seconds(client: TestClient) -> None:
    # Set TREASURY_USD for test
    os.environ["TREASURY_USD"] = "50000000"

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

    # 2. Call POST /summarize and measure execution time
    start_time = time.time()
    resp = client.post("/summarize", json={"proposalId": "MIP-17"})
    elapsed = time.time() - start_time

    assert resp.status_code == 200
    assert elapsed < 20.0, f"Expected runtime under 20s, got {elapsed:.2f}s"

    data = resp.json()
    summary = DecisionSummary.model_validate(data)
    assert summary.proposalId == "MIP-17"
    assert len(summary.tldr) > 0

    # 3. Treasury Impact verification
    assert summary.treasuryImpact.amountUsd == 2500000.0
    # 2,500,000 / 50,000,000 * 100 = 5.0%
    assert summary.treasuryImpact.pctOfTreasury == 5.0
    assert len(summary.treasuryImpact.citations) > 0

    # All citations must reference real chunks, have valid sha256 and sourceUri,
    # and quote must be exact substring of chunk text
    for cit in summary.treasuryImpact.citations:
        chunk = get_chunk_by_id(cit.chunkId)
        assert chunk is not None
        assert cit.sha256 == chunk.sha256
        assert cit.sourceUri == chunk.sourceUri
        assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split())

    # 4. Dependencies verification
    for dep in summary.dependencies:
        for cit in dep.citations:
            chunk = get_chunk_by_id(cit.chunkId)
            assert chunk is not None
            assert cit.sha256 == chunk.sha256
            assert cit.sourceUri == chunk.sourceUri
            assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split())

    # 5. Risks verification
    assert len(summary.risks) > 0
    for risk in summary.risks:
        for cit in risk.citations:
            chunk = get_chunk_by_id(cit.chunkId)
            assert chunk is not None
            assert cit.sha256 == chunk.sha256
            assert cit.sourceUri == chunk.sourceUri
            assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split())


def test_verifier_drops_invalid_citations_and_moves_to_risks() -> None:
    # Test verifier behavior when citations are hallucinated/invalid
    os.environ["TREASURY_USD"] = "100000000"

    from app.models.contracts import Citation, Dependency, Risk, TreasuryImpact

    # A summary with invalid citations that don't match any chunk
    bad_summary = DecisionSummary(
        proposalId="MIP-17",
        tldr="Test proposal",
        treasuryImpact=TreasuryImpact(
            amountUsd=500000.0,
            pctOfTreasury=None,
            recipients=["0x1234567890123456789012345678901234567890"],
            citations=[
                Citation(
                    chunkId="non_existent_chunk",
                    sha256=Hex("0x00"),
                    quote="this quote does not exist",
                    sourceUri="fake://uri",
                )
            ],
        ),
        dependencies=[
            Dependency(
                text="Relies on unverified external audit",
                citations=[
                    Citation(
                        chunkId="non_existent_chunk_2",
                        sha256=Hex("0x00"),
                        quote="unverified external audit",
                        sourceUri="fake://uri",
                    )
                ],
            )
        ],
        risks=[],
        claims=[],
    )

    verified = verify_decision_summary_citations(bad_summary, chunks=[])

    # Treasury impact lost all citations -> amountUsd set to None, pctOfTreasury None
    assert verified.treasuryImpact.amountUsd is None
    assert verified.treasuryImpact.pctOfTreasury is None
    assert len(verified.treasuryImpact.citations) == 0

    # Dependency lost all citations -> removed from dependencies and moved to risks as 'unverified claim'
    assert len(verified.dependencies) == 0
    risk_texts = [r.text for r in verified.risks]
    assert any("Unverified claim: Relies on unverified external audit" in t for t in risk_texts)
    assert any("Unverified claim: Treasury request" in t for t in risk_texts)
