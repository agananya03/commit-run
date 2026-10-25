from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, Hex, SourceType


def parse_social_json(
    file_path: Path | str,
    proposal_id: str,
    start_chunk_idx: int = 0,
) -> list[Chunk]:
    path = Path(file_path)
    filename = path.name

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages: list[dict[str, Any]] = []
    if isinstance(data, list):
        messages = data
    elif isinstance(data, dict):
        if "messages" in data and isinstance(data["messages"], list):
            messages = data["messages"]
        elif "posts" in data and isinstance(data["posts"], list):
            messages = data["posts"]
        else:
            messages = [data]

    chunks: list[Chunk] = []
    chunk_counter = start_chunk_idx

    for idx, msg in enumerate(messages):
        raw_text = (
            msg.get("text")
            or msg.get("content")
            or msg.get("message")
            or msg.get("body")
            or ""
        )
        author = msg.get("author") or msg.get("username") or msg.get("handle") or ""

        text = str(raw_text).strip()
        # If author is provided and not already in text prefix, format clearly
        if author and not text.startswith(author) and not text.startswith(f"@{author}"):
            clean_author = author if author.startswith("@") else f"@{author}"
            text = f"{clean_author}: {text}"

        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        msg_id = msg.get("id", idx)
        source_uri = f"social://{proposal_id}/{filename}#msg={msg_id}"
        chunk = Chunk(
            id=f"{proposal_id}:social:{chunk_counter}",
            proposalId=proposal_id,
            sourceType=SourceType.social,
            sourceUri=source_uri,
            page=None,
            text=text,
            sha256=Hex(f"0x{h}"),
        )
        chunks.append(chunk)
        chunk_counter += 1

    return chunks
