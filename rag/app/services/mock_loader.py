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
    data = load_mock_json("ingest", proposal_id)
    return [Chunk.model_validate(c) for c in data]


def load_mock_summary(proposal_id: str = "MIP-21") -> DecisionSummary:
    data = load_mock_json("summarize", proposal_id)
    return DecisionSummary.model_validate(data)


def load_mock_intent(proposal_id: str = "MIP-21") -> IntentSpec:
    data = load_mock_json("extract-intent", proposal_id)
    return IntentSpec.model_validate(data)
