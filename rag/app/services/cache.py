from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from app.models.contracts import DecisionSummary

# Directory where pre-computed and runtime cache files live
CACHE_DIR = Path(__file__).resolve().parents[2] / "cache"
EMBEDDINGS_CACHE_DIR = CACHE_DIR / "embeddings"
LLM_CACHE_DIR = CACHE_DIR / "llm"


def ensure_cache_dirs() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    EMBEDDINGS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    LLM_CACHE_DIR.mkdir(parents=True, exist_ok=True)


# In-memory caches for maximum sub-millisecond retrieval speed
_memory_embeddings_cache: dict[str, list[float]] = {}
_memory_llm_cache: dict[str, Any] = {}
_memory_proposal_cache: dict[str, DecisionSummary] = {}


def compute_embedding_key(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def compute_llm_key(prompt: str, chunk_ids: list[str], model: str) -> str:
    """
    Keyed by sha256 of (prompt + chunk ids + model).
    """
    sorted_chunks = ",".join(sorted(chunk_ids))
    raw = f"PROMPT::{prompt}::CHUNKS::{sorted_chunks}::MODEL::{model}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_embedding(text: str) -> list[float] | None:
    key = compute_embedding_key(text)
    if key in _memory_embeddings_cache:
        return _memory_embeddings_cache[key]

    ensure_cache_dirs()
    path = EMBEDDINGS_CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                _memory_embeddings_cache[key] = data
                return data
        except Exception:
            pass
    return None


def set_cached_embedding(text: str, embedding: list[float]) -> None:
    key = compute_embedding_key(text)
    _memory_embeddings_cache[key] = embedding
    ensure_cache_dirs()
    path = EMBEDDINGS_CACHE_DIR / f"{key}.json"
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(embedding, f)
    except Exception:
        pass


def get_cached_llm_response(prompt: str, chunk_ids: list[str], model: str) -> Any | None:
    key = compute_llm_key(prompt, chunk_ids, model)
    if key in _memory_llm_cache:
        return _memory_llm_cache[key]

    ensure_cache_dirs()
    path = LLM_CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                _memory_llm_cache[key] = data
                return data
        except Exception:
            pass
    return None


def set_cached_llm_response(prompt: str, chunk_ids: list[str], model: str, response: Any) -> None:
    key = compute_llm_key(prompt, chunk_ids, model)
    _memory_llm_cache[key] = response
    ensure_cache_dirs()
    path = LLM_CACHE_DIR / f"{key}.json"
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(response, f, indent=2)
    except Exception:
        pass


def get_cached_proposal_summary(proposal_id: str) -> DecisionSummary | None:
    """
    Returns the cached DecisionSummary for that proposal.
    Checks memory first, then /rag/cache/{proposal_id}.json.
    """
    if proposal_id in _memory_proposal_cache:
        cached = _memory_proposal_cache[proposal_id].model_copy(deep=True)
        cached.cached = True
        return cached

    ensure_cache_dirs()
    path = CACHE_DIR / f"{proposal_id}.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                summary = DecisionSummary.model_validate(data)
                summary.cached = True
                _memory_proposal_cache[proposal_id] = summary
                return summary
        except Exception as e:
            print(f"Warning: Failed reading proposal cache {path}: {e}")

    return None


def save_cached_proposal_summary(proposal_id: str, summary: DecisionSummary) -> None:
    """
    Saves a DecisionSummary to /rag/cache/{proposal_id}.json and memory.
    """
    _memory_proposal_cache[proposal_id] = summary
    ensure_cache_dirs()
    path = CACHE_DIR / f"{proposal_id}.json"
    try:
        data = summary.model_dump(mode="json")
        data["cached"] = True
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed writing proposal cache {path}: {e}")
