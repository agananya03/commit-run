from __future__ import annotations

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app
from app.models.contracts import Chunk, DecisionSummary, TreasuryImpact
from app.models.requests import IngestFile, IngestRequest
from app.services.citation_verifier import verify_decision_summary_citations
from app.services.ingest import ingest_proposal_files
from app.services.parsers.forum import parse_forum_json
from app.services.parsers.pdf import parse_pdf
from app.services.translator import is_english, translate_to_english


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_deduplicate_files_by_sha256(tmp_path: Path) -> None:
    """Duplicate files with matching sha256 should be deduplicated upon ingestion."""
    # Create two files with identical content but different names
    f1 = tmp_path / "post_copy1.json"
    f2 = tmp_path / "post_copy2.json"
    content = json.dumps([{"author": "alice", "text": "Unique governance proposal discussion"}])
    f1.write_text(content, encoding="utf-8")
    f2.write_text(content, encoding="utf-8")

    req = IngestRequest(
        proposalId="TEST-DEDUP",
        files=[
            IngestFile(type="forum", path=str(f1)),
            IngestFile(type="forum", path=str(f2)),
        ],
    )
    chunks = ingest_proposal_files(req)
    # Since f2 is an exact duplicate of f1 by sha256, it must only be parsed once
    assert len(chunks) == 1
    assert "Unique governance proposal" in chunks[0].text


def test_empty_pdf_no_extractable_text_warning(tmp_path: Path) -> None:
    """Empty or image-only PDF returns a clear 'no extractable text' evidence warning."""
    # Create a blank 1-page PDF with no text
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    blank_pdf = tmp_path / "blank.pdf"
    with open(blank_pdf, "wb") as fp:
        writer.write(fp)

    chunks = parse_pdf(blank_pdf, proposal_id="TEST-EMPTY")
    assert len(chunks) == 1
    chunk = chunks[0]
    assert "no extractable text" in chunk.text.lower()
    assert "[Evidence Warning: no extractable text]" in chunk.text
    assert "#warning=no_extractable_text" in chunk.sourceUri


def test_forum_broken_link_records_unresolved_external_reference(tmp_path: Path) -> None:
    """Broken links in forum posts are recorded as 'unresolved external reference' risks."""
    forum_file = tmp_path / "forum_broken.json"
    post_data = [
        {
            "author": "bob",
            "post_number": 1,
            "text": "Please check the audit report at https://audit-deadlink.invalid/report.pdf for details.",
        }
    ]
    forum_file.write_text(json.dumps(post_data), encoding="utf-8")

    chunks = parse_forum_json(forum_file, proposal_id="TEST-BROKEN")
    assert len(chunks) >= 1
    chunk_text = chunks[0].text
    assert "[Risk: unresolved external reference]" in chunk_text
    assert "https://audit-deadlink.invalid/report.pdf" in chunk_text

    # Verify that DecisionSummary includes this as an unresolved external reference risk
    dummy_summary = DecisionSummary(
        proposalId="TEST-BROKEN",
        tldr="Proposal with broken audit link.",
        treasuryImpact=TreasuryImpact(
            amountUsd=None,
            pctOfTreasury=None,
            recipients=[],
            citations=[],
        ),
        dependencies=[],
        risks=[],
        claims=[],
    )
    verified = verify_decision_summary_citations(dummy_summary, chunks)
    matching_risks = [r for r in verified.risks if "unresolved external reference" in r.text]
    assert len(matching_risks) >= 1
    assert len(matching_risks[0].citations) >= 1
    assert matching_risks[0].citations[0].chunkId == chunks[0].id


def test_forum_non_english_post_translated_before_embedding(tmp_path: Path) -> None:
    """Non-English forum posts are translated to English before embedding."""
    # Test language detector
    assert not is_english("Esta propuesta solicita una asignacion de fondos para el equipo")
    assert is_english("This proposal requests an allocation of funds for the team")

    # Test translator
    translated = translate_to_english("Esta propuesta solicita una asignacion de fondos")
    assert "allocation of funds" in translated.lower() or "proposal" in translated.lower()

    # Test forum ingestion pipeline translates before embedding
    forum_file = tmp_path / "forum_spanish.json"
    post_data = [
        {
            "author": "carlos",
            "post_number": 2,
            "text": "Esta propuesta solicita una asignacion de fondos para infraestructura.",
        }
    ]
    forum_file.write_text(json.dumps(post_data), encoding="utf-8")

    chunks = parse_forum_json(forum_file, proposal_id="TEST-ES")
    assert len(chunks) >= 1
    # Chunk text should contain translation and original context
    assert "[Translated]:" in chunks[0].text
    assert "allocation of funds" in chunks[0].text.lower() or "proposal" in chunks[0].text.lower()


def test_ask_endpoint_answers_with_verified_citations(client: TestClient) -> None:
    """POST /ask answers questions using verified citations only."""
    payload = {
        "proposalId": "MIP-17",
        "question": "What is the USDC allocation requested for Phase 1 Core Routing Engine?",
    }
    resp = client.post("/ask", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["proposalId"] == "MIP-17"
    assert data["refused"] is False
    assert len(data["citations"]) > 0

    citation = data["citations"][0]
    assert citation["chunkId"].startswith("MIP-17:")
    assert citation["sha256"].startswith("0x")
    assert len(citation["quote"]) > 0

    # Ensure quote is in the chunk
    chunk_resp = client.get(f"/chunks/{citation['chunkId']}")
    assert chunk_resp.status_code == 200
    chunk_data = chunk_resp.json()
    assert citation["quote"] in chunk_data["text"]


def test_ask_endpoint_refuses_when_evidence_is_missing(client: TestClient) -> None:
    """POST /ask refuses when evidence is missing."""
    payload = {
        "proposalId": "MIP-17",
        "question": "What is the astronaut training schedule for the Mars expedition launch?",
    }
    resp = client.post("/ask", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["proposalId"] == "MIP-17"
    assert data["refused"] is True
    assert "Refused: Insufficient verified evidence" in data["answer"]
    assert data["citations"] == []
