from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, Hex, SourceType


def parse_onchain_json(
    file_path: Path | str,
    proposal_id: str,
    start_chunk_idx: int = 0,
) -> list[Chunk]:
    path = Path(file_path)
    filename = path.name

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    chunks: list[Chunk] = []
    chunk_counter = start_chunk_idx

    items: list[dict[str, Any]] = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        if "calls" in data and isinstance(data["calls"], list):
            items = data["calls"]
        elif "actions" in data and isinstance(data["actions"], list):
            items = data["actions"]
        else:
            items = [data]

    for idx, item in enumerate(items):
        if "text" in item:
            text = str(item["text"]).strip()
        else:
            # Build structured onchain call string
            parts = []
            if "proposalId" in item:
                parts.append(f"ProposalCreated proposalId={item['proposalId']}")
            if "proposer" in item:
                parts.append(f"proposer={item['proposer']}")
            if "targets" in item:
                parts.append(f"targets={json.dumps(item['targets'])}")
            if "values" in item:
                parts.append(f"values={json.dumps(item['values'])}")
            if "calldatas" in item:
                parts.append(f"calldatas={json.dumps(item['calldatas'])}")
            if "description" in item:
                parts.append(f"description={json.dumps(item['description'])}")
            if not parts:
                parts.append(json.dumps(item))
            text = " ".join(parts)

        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        source_uri = f"onchain://{proposal_id}/{filename}#call={idx}"
        chunk = Chunk(
            id=f"{proposal_id}:onchain:{chunk_counter}",
            proposalId=proposal_id,
            sourceType=SourceType.onchain,
            sourceUri=source_uri,
            page=None,
            text=text,
            sha256=Hex(f"0x{h}"),
        )
        chunks.append(chunk)
        chunk_counter += 1

    return chunks
