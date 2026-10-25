from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, Hex, SourceType
from app.services.tokenizer import split_text_into_token_chunks


def _strip_html(text: str) -> str:
    clean = re.compile(r"<.*?>")
    return re.sub(clean, "", text).strip()


def parse_forum_json(
    file_path: Path | str,
    proposal_id: str,
    start_chunk_idx: int = 0,
) -> list[Chunk]:
    path = Path(file_path)
    filename = path.name

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Discourse-style or generic post list
    posts_data: list[dict[str, Any]] = []
    thread_title = ""

    if isinstance(data, dict):
        thread_title = data.get("title", "")
        if "post_stream" in data and isinstance(data["post_stream"], dict):
            posts_data = data["post_stream"].get("posts", [])
        elif "posts" in data and isinstance(data["posts"], list):
            posts_data = data["posts"]
        else:
            posts_data = [data]
    elif isinstance(data, list):
        posts_data = data

    chunks: list[Chunk] = []
    chunk_counter = start_chunk_idx

    for idx, post in enumerate(posts_data):
        author = (
            post.get("author")
            or post.get("username")
            or post.get("name")
            or "anonymous"
        )
        post_number = (
            post.get("post_number")
            or post.get("postNumber")
            or post.get("id")
            or (idx + 1)
        )
        reply_to = (
            post.get("reply_to")
            or post.get("reply_to_post_number")
            or post.get("replyTo")
        )
        raw_text = (
            post.get("text")
            or post.get("raw")
            or post.get("content")
            or post.get("cooked")
            or ""
        )
        body = _strip_html(str(raw_text)).strip()

        # Build clean formatted text with author and reply context
        reply_context = f" (in reply to #{reply_to})" if reply_to else ""
        title_header = f"[{thread_title}] " if thread_title and idx == 0 and thread_title not in body else ""
        header = f"{title_header}Post #{post_number} by {author}{reply_context}:\n"
        full_text = f"{header}{body}".strip()

        # Split long posts at ~350 tokens with 50 overlap
        sub_chunks = split_text_into_token_chunks(full_text, max_tokens=350, overlap=50)
        if not sub_chunks:
            sub_chunks = [full_text]

        for sub_text in sub_chunks:
            h = hashlib.sha256(sub_text.encode("utf-8")).hexdigest()
            source_uri = f"forum://{proposal_id}/{filename}#post={post_number}"
            chunk = Chunk(
                id=f"{proposal_id}:forum:{chunk_counter}",
                proposalId=proposal_id,
                sourceType=SourceType.forum,
                sourceUri=source_uri,
                page=None,
                text=sub_text,
                sha256=Hex(f"0x{h}"),
            )
            chunks.append(chunk)
            chunk_counter += 1

    return chunks
