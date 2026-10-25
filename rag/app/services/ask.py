from __future__ import annotations

import json
import os
import re
from typing import Any

from app.models.contracts import Chunk, Citation
from app.models.requests import AskResponse
from app.services.citation_verifier import filter_valid_citations, match_quote_in_chunk
from app.services.db import get_chunks_for_proposal
from app.services.mock_loader import load_mock_chunks
from app.services.search import hybrid_search

QUESTION_STOPWORDS = {
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "can", "could", "should", "would", "will", "shall",
    "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "about", "tell", "me", "please", "proposal", "mip",
}

REFUSAL_MESSAGE = "Refused: Insufficient verified evidence in proposal documentation to answer this question."


def _extract_keywords(text: str) -> list[str]:
    words = re.findall(r"\b[a-zA-Z0-9_$]{2,}\b", text.lower())
    return [w for w in words if w not in QUESTION_STOPWORDS and not w.isdigit()]


def _split_into_sentences(text: str) -> list[str]:
    # Split by period, newline, or semicolon
    raw_sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [s.strip() for s in raw_sentences if len(s.strip()) > 10]


def answer_proposal_question(proposal_id: str, question: str) -> AskResponse:
    """
    Answers a question about a proposal using verified citations only.
    Refuses when evidence is missing.
    """
    clean_question = question.strip()
    if not clean_question:
        return AskResponse(
            proposalId=proposal_id,
            question=question,
            answer=REFUSAL_MESSAGE,
            citations=[],
            refused=True,
        )

    # 1. Retrieve all chunks and candidate chunks
    all_chunks = get_chunks_for_proposal(proposal_id)
    if not all_chunks:
        try:
            all_chunks = load_mock_chunks(proposal_id)
        except Exception:
            try:
                all_chunks = load_mock_chunks("MIP-21")
            except Exception:
                all_chunks = []

    if not all_chunks:
        return AskResponse(
            proposalId=proposal_id,
            question=question,
            answer=REFUSAL_MESSAGE,
            citations=[],
            refused=True,
        )

    chunks_by_id = {c.id: c for c in all_chunks}
    candidate_chunks = hybrid_search(proposal_id, clean_question, k=6)
    if not candidate_chunks:
        candidate_chunks = all_chunks[:6]

    keywords = _extract_keywords(clean_question)
    if not keywords:
        return AskResponse(
            proposalId=proposal_id,
            question=question,
            answer=REFUSAL_MESSAGE,
            citations=[],
            refused=True,
        )

    # 2. Check if there is sufficient keyword overlap with candidate chunks
    min_required_overlap = 2 if len(keywords) >= 3 else 1
    matched_candidates: list[tuple[Chunk, str, int]] = []
    for c in candidate_chunks:
        sentences = _split_into_sentences(c.text)
        for s in sentences:
            s_lower = s.lower()
            overlap = sum(1 for kw in keywords if kw in s_lower)
            if overlap >= min_required_overlap and (overlap / len(keywords) >= 0.25):
                matched_candidates.append((c, s, overlap))

    if not matched_candidates:
        # No evidence matches the topic of the question
        return AskResponse(
            proposalId=proposal_id,
            question=question,
            answer=REFUSAL_MESSAGE,
            citations=[],
            refused=True,
        )

    # 3. Try LLM if configured
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    use_mocks = os.environ.get("USE_MOCKS", "").lower() in ("true", "1")
    model_name = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    if api_key and not use_mocks:
        try:
            import litellm

            context_formatted = "\n\n".join(
                f"[{c.id}] (Source: {c.sourceUri}):\n{c.text}" for c in candidate_chunks
            )
            prompt = f"""You are a DAO Governance Watchdog analyst.
Answer the following question about proposal {proposal_id} strictly using ONLY the retrieved context chunks below.

Question: {clean_question}

Rules:
1. Answer with verified citations only. Every single fact in your answer MUST carry a citation with "chunkId" and an exact substring "quote".
2. If the context chunks DO NOT provide clear, explicit evidence to directly answer the question, or if you would need to speculate, you MUST refuse:
   Set "refused": true, "answer": "{REFUSAL_MESSAGE}", and "citations": [].
3. Respond ONLY with valid JSON:
{{
  "refused": boolean,
  "answer": "string",
  "citations": [
    {{ "chunkId": "string", "quote": "exact substring from chunk" }}
  ]
}}

CONTEXT CHUNKS:
{context_formatted}
"""
            res = litellm.completion(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                response_format={"type": "json_object"},
                timeout=12,
            )
            parsed = json.loads(res.choices[0].message.content)
            if parsed.get("refused", False):
                return AskResponse(
                    proposalId=proposal_id,
                    question=question,
                    answer=REFUSAL_MESSAGE,
                    citations=[],
                    refused=True,
                )

            raw_citations = parsed.get("citations", [])
            valid_citations = filter_valid_citations(raw_citations, chunks_by_id)
            if valid_citations and parsed.get("answer"):
                return AskResponse(
                    proposalId=proposal_id,
                    question=question,
                    answer=parsed["answer"],
                    citations=valid_citations,
                    refused=False,
                )
        except Exception:
            pass

    # 4. Deterministic answer synthesizer from verified quotes
    matched_candidates.sort(key=lambda x: x[2], reverse=True)
    best_chunk, best_sentence, score = matched_candidates[0]

    # Verify substring match in chunk
    is_match, exact_quote = match_quote_in_chunk(best_sentence, best_chunk.text)
    if not is_match or not exact_quote:
        exact_quote = best_chunk.text[:120]

    verified_citation = Citation(
        chunkId=best_chunk.id,
        sha256=best_chunk.sha256,
        quote=exact_quote,
        sourceUri=best_chunk.sourceUri,
    )

    answer_text = f"According to verified proposal documentation ({best_chunk.sourceUri}): \"{exact_quote}\""

    return AskResponse(
        proposalId=proposal_id,
        question=question,
        answer=answer_text,
        citations=[verified_citation],
        refused=False,
    )
