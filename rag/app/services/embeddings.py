from __future__ import annotations

import hashlib
import math
import os
import sys
from typing import Sequence

# Prevent known Windows Python 3.13 pyarrow C-extension crash during optional import
sys.modules.setdefault("pyarrow", None)  # type: ignore

# BAAI/bge-small-en-v1.5 (384 dimensions, normalized)
MODEL_NAME = "BAAI/bge-small-en-v1.5"



class BgeSmallEmbedder:
    """
    Sentence embedding model using BAAI/bge-small-en-v1.5 (384 dimensions, normalized).
    Uses [CLS] pooling followed by L2 normalization, exactly matching sentence-transformers.
    """

    def __init__(self, model_name: str = MODEL_NAME) -> None:
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.model_name = model_name
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModel.from_pretrained(model_name)
        self.model.eval()

    def encode(
        self,
        sentences: Sequence[str],
        normalize_embeddings: bool = True,
        batch_size: int = 32,
    ) -> list[list[float]]:
        import torch
        import torch.nn.functional as F

        if not sentences:
            return []

        all_embeddings: list[list[float]] = []
        sentence_list = list(sentences)

        for i in range(0, len(sentence_list), batch_size):
            batch = sentence_list[i : i + batch_size]
            encoded = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            with torch.no_grad():
                outputs = self.model(**encoded)
                # BGE models use CLS token pooling (pooling_mode_cls_token: true)
                cls_tokens = outputs.last_hidden_state[:, 0]
                if normalize_embeddings:
                    embeddings = F.normalize(cls_tokens, p=2, dim=1)
                else:
                    embeddings = cls_tokens
                all_embeddings.extend(embeddings.cpu().tolist())

        return all_embeddings


_embedder: BgeSmallEmbedder | None = None


def load_embedding_model() -> BgeSmallEmbedder | None:
    """
    Loads sentence-transformers BAAI/bge-small-en-v1.5 once at startup.
    """
    global _embedder
    if _embedder is None:
        try:
            _embedder = BgeSmallEmbedder(MODEL_NAME)
        except Exception as e:
            print(f"Warning: Failed to load BAAI/bge-small-en-v1.5: {e}")
            _embedder = None
    return _embedder


def _fallback_embedding(text: str, dim: int = 384) -> list[float]:
    """
    Deterministic normalized 384-dim pseudo-embedding fallback if torch is unavailable.
    """
    vec = [0.0] * dim
    words = text.lower().split()
    for w in words:
        h = int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16)
        idx = h % dim
        vec[idx] += 1.0

    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        vec = [x / norm for x in vec]
    else:
        vec[0] = 1.0
    return vec


def generate_embeddings(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        return []

    embedder = load_embedding_model()
    if embedder is not None:
        try:
            return embedder.encode(list(texts), normalize_embeddings=True)
        except Exception as e:
            print(f"Warning: Embedding generation failed: {e}")

    return [_fallback_embedding(t) for t in texts]


def generate_single_embedding(text: str) -> list[float]:
    return generate_embeddings([text])[0]

