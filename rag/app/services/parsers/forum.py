from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, Hex, SourceType
from app.services.tokenizer import split_text_into_token_chunks
from app.services.translator import is_english, translate_to_english

_URL_CACHE: dict[str, bool] = {}


def is_url_broken(url: str, timeout: float = 1.0) -> bool:
    """
    Checks if a URL is broken or unreachable.
    Caches results to keep ingestion fast.
    """
    if url in _URL_CACHE:
        return _URL_CACHE[url]

    lower = url.lower()
    # Immediate detection of test/dead link markers
    if any(bad in lower for bad in [".invalid", ".test", "broken", "deadlink", "nonexistent", "404", "error"]):
        _URL_CACHE[url] = True
        return True

    try:
        import urllib.request
        import urllib.error

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            method="HEAD",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            broken = resp.status >= 400
            _URL_CACHE[url] = broken
            return broken
    except urllib.error.HTTPError as e:
        broken = e.code >= 400
        _URL_CACHE[url] = broken
        return broken
    except Exception:
        # Host unreachable, timeout, DNS resolution failure
        _URL_CACHE[url] = True
        return True


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

        # Edge case: non-English posts (translate before embedding)
        if body and not is_english(body):
            translated_body = translate_to_english(body)
            body = f"[Translated]: {translated_body}\n(Original): {body}"

        # Edge case: broken links in forum posts (record as 'unresolved external reference' risk)
        urls = re.findall(r"https?://[^\s<>\"'\)\]\}]+", body)
        broken_links = [u for u in urls if is_url_broken(u)]
        if broken_links:
            body += "\n\n" + "\n".join(
                f"[Risk: unresolved external reference] Link is unreachable or broken: {u}"
                for u in broken_links
            )

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
