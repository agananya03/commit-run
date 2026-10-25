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


def test_mip21_intent_spec_exclusions_with_verified_citations(client: TestClient) -> None:
    resp = client.post("/extract-intent", json={"proposalId": "MIP-21"})
    assert resp.status_code == 200
    spec = IntentSpec.model_validate(resp.json())

    # 1. Must contain upgrade action that names the proxy and describes functional change in one line
    upgrade_action = next((a for a in spec.actions if a.kind.value == "upgrade"), None)
    assert upgrade_action is not None, "MIP-21 must contain an upgrade action"
    assert "vault" in upgrade_action.target.lower() and "proxy" in upgrade_action.target.lower(), "Action target must name the proxy"
    assert any(term in upgrade_action.description.lower() for term in ["gas", "storage", "packing", "rebalance"]), "Action description must describe expected functional change in one line"

    # 2. IntentSpec must contain explicitlyExcluded promises: 'storage layout unchanged', 'no new admin functions', 'no change to ownership'
    assert "storage layout unchanged" in spec.explicitlyExcluded
    assert "no new admin functions" in spec.explicitlyExcluded
    assert "no change to ownership" in spec.explicitlyExcluded

    # 3. Action description must list those exclusions
    assert "storage layout unchanged" in upgrade_action.description.lower()
    assert "no new admin functions" in upgrade_action.description.lower()
    assert "no change to ownership" in upgrade_action.description.lower()

    # 4. Exclusions must be backed by verified citations
    assert len(upgrade_action.citations) >= 3
    chunks = retrieve_human_chunks("MIP-21")
    c_map = {c.id: c for c in chunks}

    found_storage_cit = False
    found_admin_cit = False
    found_ownership_cit = False

    for cit in upgrade_action.citations:
        assert cit.chunkId in c_map, f"Citation chunkId {cit.chunkId} not found in proposal chunks"
        chunk = c_map[cit.chunkId]
        assert cit.sha256 == chunk.sha256, f"Citation sha256 mismatch for chunk {cit.chunkId}"
        assert cit.sourceUri == chunk.sourceUri, f"Citation sourceUri mismatch for chunk {cit.chunkId}"
        assert cit.quote in chunk.text or " ".join(cit.quote.split()) in " ".join(chunk.text.split()), f"Citation quote '{cit.quote}' not found in chunk text"

        q_lower = cit.quote.lower()
        if "storage" in q_lower or "slot" in q_lower:
            found_storage_cit = True
        if "admin" in q_lower or "role" in q_lower or "timelock" in q_lower:
            found_admin_cit = True
        if "ownership" in q_lower or "owner" in q_lower:
            found_ownership_cit = True

    assert found_storage_cit, "Verified citation for 'storage layout unchanged' must be present"
    assert found_admin_cit, "Verified citation for 'no new admin functions' must be present"
    assert found_ownership_cit, "Verified citation for 'no change to ownership' must be present"


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
