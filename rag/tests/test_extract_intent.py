from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import IntentSpec, SourceType
from app.services.extract_intent import (
    _load_deployments,
    get_token_decimals,
    normalize_amount_to_base_units,
    resolve_recipient,
    retrieve_human_chunks,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_extract_intent_mip21(client: TestClient) -> None:
    resp = client.post("/extract-intent", json={"proposalId": "MIP-21"})
    assert resp.status_code == 200
    data = resp.json()

    spec = IntentSpec.model_validate(data)
    assert spec.proposalId == "MIP-21"
    assert len(spec.actions) > 0
    assert any("change to ownership" in x for x in spec.explicitlyExcluded)
    assert spec.confidence >= 0.8

    # Ensure all citations strictly exclude onchain sources
    for act in spec.actions:
        for cit in act.citations:
            assert "onchain" not in cit.sourceUri.lower()
            assert cit.sha256.root.startswith("0x")


def test_extract_intent_mip17(client: TestClient) -> None:
    resp = client.post("/extract-intent", json={"proposalId": "MIP-17"})
    assert resp.status_code == 200
    data = resp.json()

    spec = IntentSpec.model_validate(data)
    assert spec.proposalId == "MIP-17"
    assert len(spec.actions) > 0

    # Verify amount normalized to base units (USDC: 6 decimals -> 5,000,000 * 10^6)
    transfer_action = next((a for a in spec.actions if a.kind.value == "transfer"), None)
    assert transfer_action is not None
    assert transfer_action.amount == "5000000000000"
    assert len(transfer_action.citations) > 0

    for cit in transfer_action.citations:
        assert "onchain" not in cit.sourceUri.lower()


def test_extract_intent_mip12(client: TestClient) -> None:
    resp = client.post("/extract-intent", json={"proposalId": "MIP-12"})
    assert resp.status_code == 200
    data = resp.json()

    spec = IntentSpec.model_validate(data)
    assert spec.proposalId == "MIP-12"
    assert len(spec.actions) > 0

    transfer_action = next((a for a in spec.actions if a.kind.value == "transfer"), None)
    assert transfer_action is not None
    # 400,000 USDC -> 400000000000 base units
    assert transfer_action.amount == "400000000000"


def test_strictly_exclude_onchain_chunks() -> None:
    chunks = retrieve_human_chunks("MIP-21")
    assert len(chunks) > 0
    for c in chunks:
        assert c.sourceType.value != "onchain"
        assert getattr(c.sourceType, "value", c.sourceType) in ("forum", "pdf", "social")


def test_normalization_and_decimals() -> None:
    deployments = _load_deployments()
    assert get_token_decimals("USDC", deployments) == 6
    assert get_token_decimals("MRD", deployments) == 18

    # Test normalization
    norm_usdc = normalize_amount_to_base_units("400,000", "USDC", deployments)
    assert norm_usdc == "400000000000"

    norm_5m = normalize_amount_to_base_units("$5M", "USDC", deployments)
    assert norm_5m == "5000000000000"


def test_recipient_resolution() -> None:
    text_with_addr = "Disbursed to Nexus Labs at 0x71C836384191a83359d9B9582A45C8697A2E50dE"
    resolved_with_addr = resolve_recipient("Nexus Labs", text_with_addr)
    assert resolved_with_addr == "0x71C836384191a83359d9B9582A45C8697A2E50dE"

    text_without_addr = "Disbursed to Meridian Studio Collective for developer tooling."
    resolved_without_addr = resolve_recipient("Meridian Studio Collective", text_without_addr)
    assert resolved_without_addr == "Meridian Studio Collective"
