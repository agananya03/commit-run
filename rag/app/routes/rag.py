from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException, status

from app.models.contracts import Chunk, DecisionSummary, IntentSpec
from app.models.requests import (
    AskRequest,
    AskResponse,
    ExplainRequest,
    ExtractIntentRequest,
    IngestRequest,
    SearchRequest,
    SummarizeRequest,
)
from app.services.citation_verifier import verify_decision_summary_citations
from app.services.db import get_chunk_by_id, get_chunks_for_proposal, init_db
from app.services.mock_loader import (
    load_mock_chunks,
    load_mock_intent,
    load_mock_summary,
)
from app.services.ingest import ingest_proposal_files
from app.services.search import hybrid_search
from app.services.summarize import generate_decision_summary
from app.services.extract_intent import extract_intent_spec
from app.services.ask import answer_proposal_question

router = APIRouter()






@router.get("/health", response_model=dict[str, str])
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/ingest", response_model=list[Chunk])
def ingest(request: IngestRequest) -> list[Chunk]:
    """
    Ingests proposal documents (forum JSON, PDF, social, onchain), parses them into chunks,
    stores in Postgres (schema 'rag', vector 384), and returns all chunks.
    """
    return ingest_proposal_files(request)


@router.post("/summarize", response_model=DecisionSummary)
def summarize(request: SummarizeRequest) -> DecisionSummary:
    """
    Returns DecisionSummary for the proposal with verified citations.
    Retrieval runs 6 fixed sub-queries, top 5 each, dedupes, prompts LLM,
    and runs verifier.
    """
    return generate_decision_summary(request.proposalId)


@router.post("/extract-intent", response_model=IntentSpec)
def extract_intent(request: ExtractIntentRequest) -> IntentSpec:
    """
    Extracts IntentSpec strictly from human-readable proposal text (forum, pdf, social).
    Excludes onchain calldata, normalises amounts, resolves recipients, and verifies citations.
    """
    return extract_intent_spec(request.proposalId)


@router.post("/search", response_model=list[Chunk])
def search(request: SearchRequest) -> list[Chunk]:
    """
    Hybrid search ranked by 0.7 * cosine + 0.3 * BM25, filtered to proposalId.
    """
    return hybrid_search(request.proposalId, request.query, request.k)


@router.post("/explain", response_model=dict[str, Any])
def explain(request: ExplainRequest) -> dict[str, Any]:
    """
    Explains findings or proposal summary with citations.
    """
    try:
        summary = load_mock_summary(request.proposalId)
    except FileNotFoundError:
        summary = load_mock_summary("MIP-21")

    return {
        "headline": f"Analysis for {request.proposalId}",
        "paragraph": summary.tldr,
        "perFinding": [
            {
                "findingId": f.get("id", f"f{i+1}") if isinstance(f, dict) else getattr(f, "id", f"f{i+1}"),
                "sentence": f.get("does", "") if isinstance(f, dict) else getattr(f, "does", ""),
            }
            for i, f in enumerate(request.findings)
        ],
    }


@router.post("/ask", response_model=AskResponse)
def ask(request: AskRequest) -> AskResponse:
    """
    Answers a question about a proposal using verified citations only.
    Refuses when evidence is missing.
    """
    return answer_proposal_question(request.proposalId, request.question)


@router.get("/chunks/{chunk_id:path}", response_model=Chunk)
def get_chunk(chunk_id: str) -> Chunk:
    """
    Returns a single chunk by its ID.
    """
    chunk = get_chunk_by_id(chunk_id)
    if chunk is not None:
        return chunk

    # Fallback to mock search
    proposal_id = chunk_id.split(":")[0] if ":" in chunk_id else "MIP-21"
    try:
        chunks = load_mock_chunks(proposal_id)
    except FileNotFoundError:
        chunks = load_mock_chunks("MIP-21")

    for c in chunks:
        if c.id == chunk_id:
            return c

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "NOT_FOUND", "message": f"Chunk {chunk_id} not found"},
    )
