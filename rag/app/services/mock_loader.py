from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, DecisionSummary, IntentSpec


def get_shared_mocks_dir() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "shared" / "mocks"
        if candidate.exists() and candidate.is_dir():
            return candidate
    return Path.cwd() / "shared" / "mocks"



def load_mock_json(endpoint: str, proposal_id: str = "MIP-21") -> Any:
    mocks_dir = get_shared_mocks_dir()
    mock_file = mocks_dir / f"{endpoint}.{proposal_id}.json"
    if not mock_file.exists():
        mock_file = mocks_dir / f"{endpoint}.MIP-21.json"
    if not mock_file.exists():
        raise FileNotFoundError(f"Mock file not found for {endpoint} and proposal {proposal_id} in {mocks_dir}")
    with open(mock_file, "r", encoding="utf-8") as f:
        return json.load(f)


def load_mock_chunks(proposal_id: str = "MIP-21") -> list[Chunk]:
    mocks_dir = get_shared_mocks_dir()
    mock_file = mocks_dir / f"ingest.{proposal_id}.json"
    if mock_file.exists():
        with open(mock_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [Chunk.model_validate(c) for c in data]

    # Search for scenario files in data/scenarios/{proposal_id}
    current = Path(__file__).resolve()
    for parent in current.parents:
        scenario_dir = parent / "data" / "scenarios" / proposal_id
        if scenario_dir.exists() and scenario_dir.is_dir():
            from app.services.parsers.forum import parse_forum_json
            from app.services.parsers.pdf import parse_pdf
            from app.services.parsers.social import parse_social_json
            from app.services.parsers.onchain import parse_onchain_json

            chunks: list[Chunk] = []
            forum_p = scenario_dir / "forum_thread.json"
            if forum_p.exists():
                chunks.extend(parse_forum_json(forum_p, proposal_id, len(chunks)))
            pdf_p = scenario_dir / "proposal.pdf"
            if pdf_p.exists():
                chunks.extend(parse_pdf(pdf_p, proposal_id, len(chunks)))
            social_p = scenario_dir / "social.json"
            if social_p.exists():
                chunks.extend(parse_social_json(social_p, proposal_id, len(chunks)))
            onchain_p = scenario_dir / "onchain_actions.json"
            if onchain_p.exists():
                chunks.extend(parse_onchain_json(onchain_p, proposal_id, len(chunks)))

            if chunks:
                return chunks

    data = load_mock_json("ingest", proposal_id)
    return [Chunk.model_validate(c) for c in data]


def load_mock_summary(proposal_id: str = "MIP-21") -> DecisionSummary:
    data = load_mock_json("summarize", proposal_id)
    return DecisionSummary.model_validate(data)


def load_mock_intent(proposal_id: str = "MIP-21") -> IntentSpec:
    data = load_mock_json("extract-intent", proposal_id)
    return IntentSpec.model_validate(data)
