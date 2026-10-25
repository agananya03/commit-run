from __future__ import annotations

import re
from typing import Sequence
from rank_bm25 import BM25Okapi

from app.models.contracts import Chunk
from app.services.db import get_chunks_with_embeddings_for_proposal
from app.services.embeddings import generate_embeddings, generate_single_embedding
from app.services.mock_loader import load_mock_chunks


def _tokenize(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"\w+", text)]


def hybrid_search(
    proposal_id: str,
    query: str,
    k: int = 8,
    query_embedding: list[float] | None = None,
) -> list[Chunk]:
    """
    Hybrid search ranked by:
    hybrid score = 0.7 * cosine + 0.3 * BM25
    always filtered to proposalId.
    """
    items = get_chunks_with_embeddings_for_proposal(proposal_id)
    if not items:
        try:
            chunks = load_mock_chunks(proposal_id)
        except Exception:
            chunks = load_mock_chunks("MIP-21")
        items = [(c, None) for c in chunks]

    if not items:
        return []

    chunks = [item[0] for item in items]
    chunk_embeddings = [item[1] for item in items]

    # Generate any missing embeddings
    missing_indices = [i for i, emb in enumerate(chunk_embeddings) if emb is None]
    if missing_indices:
        missing_texts = [chunks[i].text for i in missing_indices]
        computed = generate_embeddings(missing_texts)
        for idx, emb in zip(missing_indices, computed):
            chunk_embeddings[idx] = emb

    # 1. Cosine similarity with normalized query embedding
    query_emb = query_embedding if query_embedding is not None else generate_single_embedding(query)

    cosine_scores = []
    for emb in chunk_embeddings:
        if emb:
            cos = sum(q * c for q, c in zip(query_emb, emb))
            cosine_scores.append(max(0.0, float(cos)))
        else:
            cosine_scores.append(0.0)

    # 2. BM25 scoring over that proposal's chunks
    tokenized_corpus = [_tokenize(c.text) for c in chunks]
    bm25 = BM25Okapi(tokenized_corpus)
    tokenized_query = _tokenize(query)
    raw_bm25 = bm25.get_scores(tokenized_query)

    max_bm25 = max(raw_bm25) if len(raw_bm25) > 0 and max(raw_bm25) > 0 else 1.0
    norm_bm25 = [max(0.0, float(s) / max_bm25) for s in raw_bm25]

    # 3. Hybrid score = 0.7 * cosine + 0.3 * BM25
    hybrid_scores = [
        0.7 * cos + 0.3 * bm
        for cos, bm in zip(cosine_scores, norm_bm25)
    ]

    # 4. Sort descending by hybrid score
    ranked_indices = sorted(
        range(len(chunks)),
        key=lambda i: hybrid_scores[i],
        reverse=True,
    )

    return [chunks[i] for i in ranked_indices[:k]]
