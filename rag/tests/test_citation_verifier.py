from __future__ import annotations

from app.models.contracts import Chunk, Citation, Claim, Hex, Kind, SourceType, Support
from app.services.citation_verifier import verify_and_clean_claim, verify_citation


def test_citation_verifier_exact_match() -> None:
    chunk = Chunk(
        id="chunk:1",
        proposalId="MIP-test",
        sourceType=SourceType.forum,
        sourceUri="forum.json",
        text="The quick brown fox jumps over the lazy dog.",
        sha256=Hex("0x1234"),
    )
    chunks_by_id = {chunk.id: chunk}

    # Valid exact substring
    cit_valid = Citation(
        chunkId="chunk:1",
        sha256=Hex("0x1234"),
        quote="quick brown fox",
        sourceUri="forum.json",
    )
    assert verify_citation(cit_valid, chunks_by_id) is True

    # Hallucinated quote
    cit_invalid_quote = Citation(
        chunkId="chunk:1",
        sha256=Hex("0x1234"),
        quote="quick blue fox",
        sourceUri="forum.json",
    )
    assert verify_citation(cit_invalid_quote, chunks_by_id) is False

    # Non-existent chunk
    cit_missing_chunk = Citation(
        chunkId="chunk:99",
        sha256=Hex("0x1234"),
        quote="quick brown fox",
        sourceUri="forum.json",
    )
    assert verify_citation(cit_missing_chunk, chunks_by_id) is False


def test_claim_citation_cleaning() -> None:
    chunk = Chunk(
        id="chunk:1",
        proposalId="MIP-test",
        sourceType=SourceType.forum,
        sourceUri="forum.json",
        text="The quick brown fox jumps over the lazy dog.",
        sha256=Hex("0x1234"),
    )
    chunks_by_id = {chunk.id: chunk}

    # Claim with a hallucinated quote
    bad_claim = Claim(
        id="cl1",
        text="The fox was blue",
        kind=Kind.technical,
        citations=[
            Citation(
                chunkId="chunk:1",
                sha256=Hex("0x1234"),
                quote="The fox was blue and jumped",  # Not in text
                sourceUri="forum.json",
            )
        ],
        support=Support.supported,
        pSupported=0.9,
    )

    cleaned = verify_and_clean_claim(bad_claim, chunks_by_id)
    # Citation must be dropped and claim marked unsupported
    assert len(cleaned.citations) == 0
    assert cleaned.support == Support.unsupported
    assert cleaned.pSupported <= 0.5
