from __future__ import annotations

import os
from pathlib import Path
from typing import Any
import psycopg
from pgvector.psycopg import register_vector
from dotenv import load_dotenv

from app.models.contracts import Chunk, Hex, SourceType

# Load root .env
root_dir = Path(__file__).resolve().parents[2]
root_env = root_dir / ".env"
if root_env.exists():
    load_dotenv(root_env)
else:
    load_dotenv()

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://meridian:meridian@localhost:5432/meridian",
)

# In-memory store fallback for offline/test environments
_in_memory_chunks: dict[str, Chunk] = {}
_in_memory_embeddings: dict[str, list[float]] = {}
_in_memory_docs: list[dict[str, Any]] = []

_db_available: bool | None = None


def get_db_connection() -> psycopg.Connection | None:
    global _db_available
    if _db_available is False:
        return None
    try:
        conn = psycopg.connect(DATABASE_URL, autocommit=True, connect_timeout=2)
        register_vector(conn)
        _db_available = True
        return conn
    except Exception:
        _db_available = False
        return None


def init_db() -> bool:
    """
    Initializes postgres schema 'rag', extension 'vector', tables, and HNSW index.
    Returns True if successfully connected and initialized, False otherwise.
    """
    conn = get_db_connection()
    if conn is None:
        return False

    try:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute("CREATE SCHEMA IF NOT EXISTS rag;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rag.documents (
                    id TEXT PRIMARY KEY,
                    proposal_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rag.chunks (
                    id TEXT PRIMARY KEY,
                    proposal_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_uri TEXT NOT NULL,
                    page REAL,
                    text TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    embedding vector(384)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_rag_chunks_proposal ON rag.chunks(proposal_id);")
            # HNSW index on embedding using vector_cosine_ops
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_rag_chunks_hnsw
                ON rag.chunks USING hnsw (embedding vector_cosine_ops);
            """)
        conn.close()
        return True
    except Exception:
        if conn:
            conn.close()
        return False


def store_documents(docs: list[dict[str, Any]]) -> None:
    for doc in docs:
        _in_memory_docs.append(doc)

    conn = get_db_connection()
    if conn is None:
        return

    try:
        with conn.cursor() as cur:
            for doc in docs:
                cur.execute(
                    """
                    INSERT INTO rag.documents (id, proposal_id, source_type, path, sha256)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        path = EXCLUDED.path,
                        sha256 = EXCLUDED.sha256;
                    """,
                    (doc["id"], doc["proposal_id"], doc["source_type"], doc["path"], doc["sha256"]),
                )
        conn.close()
    except Exception:
        if conn:
            conn.close()


def store_chunks(
    chunks: list[Chunk],
    embeddings: list[list[float]] | None = None,
) -> None:
    # Always save to in-memory store
    for idx, c in enumerate(chunks):
        _in_memory_chunks[c.id] = c
        if embeddings and idx < len(embeddings):
            _in_memory_embeddings[c.id] = embeddings[idx]

    conn = get_db_connection()
    if conn is None:
        return

    try:
        with conn.cursor() as cur:
            for idx, c in enumerate(chunks):
                emb = embeddings[idx] if embeddings and idx < len(embeddings) else None
                cur.execute(
                    """
                    INSERT INTO rag.chunks (id, proposal_id, source_type, source_uri, page, text, sha256, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        source_uri = EXCLUDED.source_uri,
                        page = EXCLUDED.page,
                        text = EXCLUDED.text,
                        sha256 = EXCLUDED.sha256,
                        embedding = EXCLUDED.embedding;
                    """,
                    (
                        c.id,
                        c.proposalId,
                        c.sourceType.value,
                        c.sourceUri,
                        c.page,
                        c.text,
                        c.sha256.root,
                        emb,
                    ),
                )
        conn.close()
    except Exception:
        if conn:
            conn.close()


def get_chunk_by_id(chunk_id: str) -> Chunk | None:
    if chunk_id in _in_memory_chunks:
        return _in_memory_chunks[chunk_id]

    conn = get_db_connection()
    if conn is None:
        return None

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, proposal_id, source_type, source_uri, page, text, sha256
                FROM rag.chunks
                WHERE id = %s
                LIMIT 1;
                """,
                (chunk_id,),
            )
            row = cur.fetchone()
            if row:
                return Chunk(
                    id=row[0],
                    proposalId=row[1],
                    sourceType=SourceType(row[2]),
                    sourceUri=row[3],
                    page=float(row[4]) if row[4] is not None else None,
                    text=row[5],
                    sha256=Hex(row[6]),
                )
        conn.close()
    except Exception:
        if conn:
            conn.close()

    return None


def get_chunks_for_proposal(proposal_id: str) -> list[Chunk]:
    chunks = [c for c in _in_memory_chunks.values() if c.proposalId == proposal_id]
    if chunks:
        return chunks

    conn = get_db_connection()
    if conn is None:
        return []

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, proposal_id, source_type, source_uri, page, text, sha256
                FROM rag.chunks
                WHERE proposal_id = %s
                ORDER BY id;
                """,
                (proposal_id,),
            )
            rows = cur.fetchall()
            result = []
            for row in rows:
                result.append(
                    Chunk(
                        id=row[0],
                        proposalId=row[1],
                        sourceType=SourceType(row[2]),
                        sourceUri=row[3],
                        page=float(row[4]) if row[4] is not None else None,
                        text=row[5],
                        sha256=Hex(row[6]),
                    )
                )
            return result
    except Exception:
        pass
    finally:
        if conn:
            conn.close()

    return []


def get_chunks_with_embeddings_for_proposal(
    proposal_id: str,
) -> list[tuple[Chunk, list[float] | None]]:
    """
    Returns chunks alongside their vector embeddings for hybrid ranking.
    """
    in_mem_items = [
        (c, _in_memory_embeddings.get(c.id))
        for c in _in_memory_chunks.values()
        if c.proposalId == proposal_id
    ]
    if in_mem_items:
        return in_mem_items

    conn = get_db_connection()
    if conn is None:
        return []

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, proposal_id, source_type, source_uri, page, text, sha256, embedding
                FROM rag.chunks
                WHERE proposal_id = %s
                ORDER BY id;
                """,
                (proposal_id,),
            )
            rows = cur.fetchall()
            results = []
            for row in rows:
                c = Chunk(
                    id=row[0],
                    proposalId=row[1],
                    sourceType=SourceType(row[2]),
                    sourceUri=row[3],
                    page=float(row[4]) if row[4] is not None else None,
                    text=row[5],
                    sha256=Hex(row[6]),
                )
                emb = list(row[7]) if row[7] is not None else None
                results.append((c, emb))
            return results
    except Exception:
        pass
    finally:
        if conn:
            conn.close()

    return []
