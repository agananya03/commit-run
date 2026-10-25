from __future__ import annotations

import os
import re
from typing import Any, Iterable
from app.models.contracts import (
    Chunk,
    Citation,
    Claim,
    DecisionSummary,
    Dependency,
    Risk,
    Support,
    TreasuryImpact,
)
from app.services.db import get_chunk_by_id


def normalize_ws(s: str) -> str:
    return " ".join(s.split())


def match_quote_in_chunk(quote: str, chunk_text: str) -> tuple[bool, str]:
    """
    Checks if quote is an exact or whitespace-normalised substring of chunk_text.
    Returns (is_match, exact_quote_to_use).
    """
    clean_quote = quote.strip()
    if not clean_quote:
        return False, ""

    # Direct exact substring
    if clean_quote in chunk_text:
        return True, clean_quote

    # Whitespace-normalised match
    norm_quote = normalize_ws(clean_quote)
    norm_text = normalize_ws(chunk_text)
    if norm_quote in norm_text:
        # Extract matching character slice from chunk_text if possible
        words = norm_quote.split()
        if words:
            first_w, last_w = words[0], words[-1]
            pos_start = chunk_text.find(first_w)
            if pos_start != -1:
                pos_end = chunk_text.find(last_w, pos_start)
                if pos_end != -1:
                    candidate = chunk_text[pos_start : pos_end + len(last_w)]
                    if normalize_ws(candidate) == norm_quote:
                        return True, candidate
        return True, clean_quote

    return False, ""


def clean_and_verify_citation(
    citation: Citation | dict[str, Any],
    chunks_by_id: dict[str, Chunk],
) -> Citation | None:
    """
    Verifies that citation references a real chunk and its quote is an exact
    (whitespace-normalised) substring. Fills sha256 and sourceUri from the chunk/db.
    Returns the verified Citation, or None if invalid.
    """
    chunk_id = citation.chunkId if isinstance(citation, Citation) else citation.get("chunkId", "")
    quote = citation.quote if isinstance(citation, Citation) else citation.get("quote", "")

    chunk = chunks_by_id.get(chunk_id)
    if chunk is None:
        chunk = get_chunk_by_id(chunk_id)
    if chunk is None:
        return None

    is_match, exact_quote = match_quote_in_chunk(quote, chunk.text)
    if not is_match:
        return None

    return Citation(
        chunkId=chunk.id,
        sha256=chunk.sha256,
        quote=exact_quote,
        sourceUri=chunk.sourceUri,
    )


def verify_citation(citation: Citation, chunks_by_id: dict[str, Chunk]) -> bool:
    """
    Checks if citation references a real chunk id and its quote is an exact
    (whitespace-normalised) substring of that chunk's text.
    """
    chunk = chunks_by_id.get(citation.chunkId)
    if chunk is None:
        chunk = get_chunk_by_id(citation.chunkId)
    if chunk is None:
        return False

    is_match, _ = match_quote_in_chunk(citation.quote, chunk.text)
    return is_match


def filter_valid_citations(
    citations: Iterable[Citation],
    chunks_by_id: dict[str, Chunk],
) -> list[Citation]:
    valid: list[Citation] = []
    for cit in citations:
        cleaned = clean_and_verify_citation(cit, chunks_by_id)
        if cleaned is not None:
            valid.append(cleaned)
    return valid


def count_independent_sources(citations: list[Citation]) -> int:
    sources = set()
    for cit in citations:
        uri = cit.sourceUri or cit.chunkId or ""
        # Group PDF pages into one PDF document source
        if uri.startswith("pdf://") or uri.endswith(".pdf") or ".pdf#" in uri:
            base = uri.split("#")[0]
            sources.add(base)
        elif "forum" in uri and "#post=" in uri:
            # Different forum posts (e.g. delegate replies #post=2, #post=3) are independent
            sources.add(uri)
        elif "social" in uri and ("#msg=" in uri or "#post=" in uri):
            # Different social messages
            sources.add(uri)
        else:
            sources.add(uri.split("#")[0] if "#" in uri else uri)
    return len(sources)


def compute_claim_psupported(support: Support, valid_citations: list[Citation]) -> tuple[Support, float]:
    if support == Support.contradicted:
        return Support.contradicted, 0.05

    if support == Support.unsupported or len(valid_citations) == 0:
        return Support.unsupported, 0.3

    # Supported with at least 1 verified citation
    sources_count = count_independent_sources(valid_citations)
    if sources_count >= 2:
        return Support.supported, 0.9
    else:
        return Support.supported, 0.7


def verify_and_clean_claim(claim: Claim, chunks_by_id: dict[str, Chunk]) -> Claim:
    """
    Verifies citation substrings. Drops unverified citations.
    pSupported: supported with 2+ independent sources 0.9, one source 0.7, unsupported 0.3, contradicted 0.05.
    """
    valid_citations = filter_valid_citations(claim.citations, chunks_by_id)

    orig_support = claim.support
    if len(valid_citations) == 0 and orig_support == Support.supported:
        orig_support = Support.unsupported

    final_support, final_psupported = compute_claim_psupported(orig_support, valid_citations)

    return Claim(
        id=claim.id,
        text=claim.text,
        kind=claim.kind,
        citations=valid_citations,
        support=final_support,
        pSupported=final_psupported,
    )


def verify_decision_summary_citations(
    summary: DecisionSummary,
    chunks: list[Chunk] | None = None,
) -> DecisionSummary:
    """
    Verifier:
    1. Fills sha256 and sourceUri from the db/chunk metadata.
    2. Drops citations whose quote is not an exact (whitespace-normalised) substring.
    3. If a field loses all citations, sets it to null or moves it to risks as 'unverified claim'.
    4. Computes pctOfTreasury from TREASURY_USD env value.
    """
    chunks_by_id = {c.id: c for c in (chunks or [])}
    unverified_risks: list[Risk] = []

    # 1. Treasury Impact
    valid_treasury_cit = filter_valid_citations(summary.treasuryImpact.citations, chunks_by_id)
    treasury_usd_env = os.environ.get("TREASURY_USD")
    try:
        treasury_usd = float(treasury_usd_env) if treasury_usd_env else 50_000_000.0
    except Exception:
        treasury_usd = 50_000_000.0

    had_treasury_claim = (
        summary.treasuryImpact.amountUsd is not None
        or len(summary.treasuryImpact.recipients) > 0
        or len(summary.treasuryImpact.citations) > 0
    )

    if had_treasury_claim and len(valid_treasury_cit) == 0:
        # Lost all citations -> set to null and move to risks as unverified claim
        unverified_risks.append(
            Risk(
                text=f"Unverified claim: Treasury request of ${summary.treasuryImpact.amountUsd or 'unknown'} lacks verified source citations",
                citations=[],
            )
        )
        amount_usd = None
        pct_of_treasury = None
        recipients = []
    else:
        amount_usd = summary.treasuryImpact.amountUsd
        recipients = summary.treasuryImpact.recipients
        if amount_usd is not None and treasury_usd > 0:
            pct_of_treasury = round((amount_usd / treasury_usd) * 100.0, 4)
        else:
            pct_of_treasury = summary.treasuryImpact.pctOfTreasury

    treasury_impact = TreasuryImpact(
        amountUsd=amount_usd,
        pctOfTreasury=pct_of_treasury,
        recipients=recipients,
        citations=valid_treasury_cit,
    )

    # 2. Dependencies
    verified_deps: list[Dependency] = []
    for dep in summary.dependencies:
        valid_deps_cit = filter_valid_citations(dep.citations, chunks_by_id)
        if len(dep.citations) > 0 and len(valid_deps_cit) == 0:
            # Lost all citations -> move to risks as 'unverified claim'
            unverified_risks.append(
                Risk(text=f"Unverified claim: {dep.text}", citations=[])
            )
        else:
            verified_deps.append(Dependency(text=dep.text, citations=valid_deps_cit))

    # 3. Risks
    verified_risks: list[Risk] = []
    for risk in summary.risks:
        valid_risk_cit = filter_valid_citations(risk.citations, chunks_by_id)
        if len(risk.citations) > 0 and len(valid_risk_cit) == 0:
            # Lost all citations -> flag as unverified claim
            r_text = risk.text if risk.text.startswith("Unverified claim:") else f"Unverified claim: {risk.text}"
            verified_risks.append(Risk(text=r_text, citations=[]))
        else:
            verified_risks.append(Risk(text=risk.text, citations=valid_risk_cit))

    # 4. Claims
    verified_claims: list[Claim] = []
    for claim in summary.claims:
        cleaned_claim = verify_and_clean_claim(claim, chunks_by_id)
        verified_claims.append(cleaned_claim)


    return DecisionSummary(
        proposalId=summary.proposalId,
        tldr=summary.tldr,
        treasuryImpact=treasury_impact,
        dependencies=verified_deps,
        risks=verified_risks + unverified_risks,
        claims=verified_claims,
    )

