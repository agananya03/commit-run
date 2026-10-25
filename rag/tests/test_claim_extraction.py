from __future__ import annotations

import os
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import Chunk, Citation, Claim, DecisionSummary, Hex, Kind, SourceType, Support
from app.services.citation_verifier import count_independent_sources, verify_and_clean_claim
from app.services.db import get_chunk_by_id


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_claim_extraction_mip21(client: TestClient) -> None:
    # 1. Ingest MIP-21 files
    ingest_payload = {
        "proposalId": "MIP-21",
        "files": [
            {"type": "forum", "path": "data/scenarios/MIP-21/forum_thread.json"},
            {"type": "pdf", "path": "data/scenarios/MIP-21/proposal.pdf"},
            {"type": "social", "path": "data/scenarios/MIP-21/social.json"},
            {"type": "onchain", "path": "data/scenarios/MIP-21/onchain_actions.json"},
        ],
    }
    ingest_resp = client.post("/ingest", json=ingest_payload)
    assert ingest_resp.status_code == 200

    # 2. Call /summarize
    resp = client.post("/summarize", json={"proposalId": "MIP-21"})
    assert resp.status_code == 200
    summary = DecisionSummary.model_validate(resp.json())

    # Up to 15 claims returned
    assert len(summary.claims) > 0
    assert len(summary.claims) <= 15

    # Check categories covered
    kinds = {c.kind for c in summary.claims}
    assert Kind.technical in kinds
    assert Kind.financial in kinds or Kind.team in kinds or Kind.timeline in kinds

    # Verify each claim
    for claim in summary.claims:
        assert claim.pSupported in (0.92, 0.82, 0.3, 0.05), f"Invalid pSupported {claim.pSupported}"

        if claim.support == Support.contradicted:
            assert claim.pSupported == 0.05
        elif claim.support == Support.unsupported:
            assert claim.pSupported == 0.3
        elif claim.support == Support.supported:
            num_sources = count_independent_sources(claim.citations)
            if num_sources >= 2:
                assert claim.pSupported == 0.92
            else:
                assert claim.pSupported == 0.82

        # Verify all citations come from non-proposer sources (NOT proposer post #1)
        for cit in claim.citations:
            chunk = get_chunk_by_id(cit.chunkId)
            assert chunk is not None, f"Referenced chunk {cit.chunkId} not in DB"
            assert cit.sha256 == chunk.sha256
            assert cit.sourceUri == chunk.sourceUri
            # Must NOT be proposer post #1
            assert "#post=1" not in cit.sourceUri
            # Quote must be an exact (whitespace-normalised) substring
            assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split())


def test_claim_extraction_mip17_with_contradicted_and_unsupported(client: TestClient) -> None:
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

    # 2. Call /summarize
    resp = client.post("/summarize", json={"proposalId": "MIP-17"})
    assert resp.status_code == 200
    summary = DecisionSummary.model_validate(resp.json())

    assert len(summary.claims) > 0
    assert len(summary.claims) <= 15

    supports = {c.support for c in summary.claims}
    # MIP-17 contains contradicted budget / milestones claims
    assert Support.contradicted in supports or Support.unsupported in supports

    # Verify pSupported mapping
    contradicted_claims = [c for c in summary.claims if c.support == Support.contradicted]
    for c in contradicted_claims:
        assert c.pSupported == 0.05

    unsupported_claims = [c for c in summary.claims if c.support == Support.unsupported]
    for c in unsupported_claims:
        assert c.pSupported == 0.3

    supported_claims = [c for c in summary.claims if c.support == Support.supported]
    for c in supported_claims:
        assert c.pSupported in (0.82, 0.92)


def test_claim_extraction_mip12(client: TestClient) -> None:
    # 1. Ingest MIP-12 files
    ingest_payload = {
        "proposalId": "MIP-12",
        "files": [
            {"type": "forum", "path": "data/scenarios/MIP-12/forum_thread.json"},
            {"type": "pdf", "path": "data/scenarios/MIP-12/proposal.pdf"},
            {"type": "social", "path": "data/scenarios/MIP-12/social.json"},
            {"type": "onchain", "path": "data/scenarios/MIP-12/onchain_actions.json"},
        ],
    }
    ingest_resp = client.post("/ingest", json=ingest_payload)
    assert ingest_resp.status_code == 200

    resp = client.post("/summarize", json={"proposalId": "MIP-12"})
    assert resp.status_code == 200
    summary = DecisionSummary.model_validate(resp.json())

    assert len(summary.claims) >= 4
    assert len(summary.claims) <= 15
    for claim in summary.claims:
        assert claim.pSupported in (0.92, 0.82, 0.3, 0.05)


def test_independent_sources_and_psupported_logic() -> None:
    # 1. Test grouping of same PDF pages as single source
    pdf_cits = [
        Citation(
            chunkId="pdf:1",
            sha256=Hex("0x01"),
            quote="foo",
            sourceUri="pdf://MIP-21/proposal.pdf#page=1",
        ),
        Citation(
            chunkId="pdf:2",
            sha256=Hex("0x02"),
            quote="bar",
            sourceUri="pdf://MIP-21/proposal.pdf#page=2",
        ),
    ]
    assert count_independent_sources(pdf_cits) == 1

    # 2. Test distinct delegate replies as independent sources
    delegate_cits = [
        Citation(
            chunkId="forum:1",
            sha256=Hex("0x01"),
            quote="foo",
            sourceUri="forum://MIP-21/forum_thread.json#post=2",
        ),
        Citation(
            chunkId="forum:2",
            sha256=Hex("0x02"),
            quote="bar",
            sourceUri="forum://MIP-21/forum_thread.json#post=3",
        ),
    ]
    assert count_independent_sources(delegate_cits) == 2

    # 3. Test PDF + delegate reply as 2 independent sources
    mixed_cits = [pdf_cits[0], delegate_cits[0]]
    assert count_independent_sources(mixed_cits) == 2
