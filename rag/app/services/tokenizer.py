from __future__ import annotations

import tiktoken

try:
    _encoder = tiktoken.get_encoding("cl100k_base")
except Exception:
    _encoder = None


def count_tokens(text: str) -> int:
    if not text:
        return 0
    if _encoder is not None:
        return len(_encoder.encode(text))
    return len(text.split())


def split_text_into_token_chunks(
    text: str,
    max_tokens: int = 350,
    overlap: int = 50,
) -> list[str]:
    """
    Splits text into chunks of at most ~350 tokens with 50 tokens overlap.
    """
    text = text.strip()
    if not text:
        return []

    if _encoder is not None:
        try:
            tokens = _encoder.encode(text)
            if len(tokens) <= max_tokens:
                return [text]

            chunks: list[str] = []
            start = 0
            step = max(1, max_tokens - overlap)
            while start < len(tokens):
                end = min(start + max_tokens, len(tokens))
                chunk_tokens = tokens[start:end]
                chunk_text = _encoder.decode(chunk_tokens).strip()
                if chunk_text:
                    chunks.append(chunk_text)
                if end >= len(tokens):
                    break
                start += step
            return chunks
        except Exception:
            pass

    # Word-based token chunk fallback
    words = text.split()
    if len(words) <= max_tokens:
        return [text]

    chunks = []
    start = 0
    step = max(1, max_tokens - overlap)
    while start < len(words):
        end = min(start + max_tokens, len(words))
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start += step
    return chunks
