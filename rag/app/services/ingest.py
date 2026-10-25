from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk
from app.models.requests import IngestFile, IngestRequest
from app.services.db import store_chunks, store_documents
from app.services.embeddings import generate_embeddings
from app.services.mock_loader import load_mock_chunks
from app.services.parsers.forum import parse_forum_json
from app.services.parsers.onchain import parse_onchain_json
from app.services.parsers.pdf import parse_pdf
from app.services.parsers.social import parse_social_json


def _resolve_path(raw_path: str) -> Path | None:
    p = Path(raw_path)
    if p.exists():
        return p.resolve()

    # Search upwards from current file
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / raw_path
        if candidate.exists():
            return candidate.resolve()

    # Search upwards from cwd
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        candidate = parent / raw_path
        if candidate.exists():
            return candidate.resolve()

    return None



def ingest_proposal_files(request: IngestRequest) -> list[Chunk]:
    """
    Ingests forum JSON, PDF, social posts, and onchain data for a proposal.
    Parses them into Chunks, generates embeddings, persists to rag schema, and returns chunks.
    """
    all_chunks: list[Chunk] = []
    docs_to_store: list[dict[str, Any]] = []

    # Counters per source type so IDs are f'{proposalId}:{type}:{n}'
    type_counters: dict[str, int] = {
        "forum": 0,
        "pdf": 0,
        "social": 0,
        "onchain": 0,
    }

    seen_file_shas: set[str] = set()

    for f in request.files:
        file_path = _resolve_path(f.path)
        if file_path is None or not file_path.exists():
            continue

        with open(file_path, "rb") as fp:
            file_bytes = fp.read()
        file_sha = f"0x{hashlib.sha256(file_bytes).hexdigest()}"

        # Deduplicate files by sha256
        if file_sha in seen_file_shas:
            continue
        seen_file_shas.add(file_sha)

        docs_to_store.append({
            "id": f"{request.proposalId}:{f.type}:{f.path}",
            "proposal_id": request.proposalId,
            "source_type": f.type,
            "path": f.path,
            "sha256": file_sha,
        })

        start_idx = type_counters[f.type]
        parsed_chunks: list[Chunk] = []

        if f.type == "forum":
            parsed_chunks = parse_forum_json(file_path, request.proposalId, start_chunk_idx=start_idx)
        elif f.type == "pdf":
            parsed_chunks = parse_pdf(file_path, request.proposalId, start_chunk_idx=start_idx)
        elif f.type == "social":
            parsed_chunks = parse_social_json(file_path, request.proposalId, start_chunk_idx=start_idx)
        elif f.type == "onchain":
            parsed_chunks = parse_onchain_json(file_path, request.proposalId, start_chunk_idx=start_idx)

        type_counters[f.type] += len(parsed_chunks)
        all_chunks.extend(parsed_chunks)

    # If no files could be parsed or files list was empty, fall back to mock
    if not all_chunks:
        try:
            all_chunks = load_mock_chunks(request.proposalId)
        except Exception:
            all_chunks = load_mock_chunks("MIP-21")

    # Generate embeddings vector(384)
    texts = [c.text for c in all_chunks]
    embeddings = generate_embeddings(texts)

    # Store in database / memory
    if docs_to_store:
        store_documents(docs_to_store)
    store_chunks(all_chunks, embeddings)

    return all_chunks
