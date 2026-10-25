from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import Explanation, Finding, PerFindingItem
from app.services.explain import (
    clean_text_for_holder,
    generate_explanation,
    shorten_address,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_shorten_address() -> None:
    # Full 42-char hex address
    addr = "0xdF3e18d64bc6a983f673ab319ccae4f1a57c7097"
    shortened = shorten_address(addr)
    assert shortened == "0xdF3e..."

    # Hex address with unicode ellipsis
    addr_uni = "0xdF3e…7097"
    assert shorten_address(addr_uni) == "0xdF3e..."

    # Already shortened
    addr_dot = "0x9f2c..."
    assert shorten_address(addr_dot) == "0x9f2c..."


def test_clean_text_for_holder() -> None:
    # Vault owner changes pattern
    raw_owner = "Vault owner changes from GuardedTimelock to 0xdF3e18d64bc6a983f673ab319ccae4f1a57c7097"
    cleaned = clean_text_for_holder(raw_owner)
    assert cleaned == "makes wallet 0xdF3e... the vault owner"

    # Treasury approval pattern
    raw_app = "Treasury approves 0xdF3e18d64bc6a983f673ab319ccae4f1a57c7097 for unlimited USDC"
    cleaned_app = clean_text_for_holder(raw_app)
    assert cleaned_app == "approves wallet 0xdF3e... to spend all USDC"


def test_explain_example_target_compliance(client: TestClient) -> None:
    """
    Validates example target:
    'The proposal promised a gas optimisation with no change to ownership. The submitted code also makes wallet 0x9f2c... the vault owner and approves it to spend all USDC.'
    """
    payload = {
        "proposalId": "MIP-21",
        "findings": [
            {
                "id": "f1",
                "severity": "critical",
                "category": "ownership_change",
                "said": "with no change to ownership",
                "does": "makes wallet 0x9f2c... the vault owner",
            },
            {
                "id": "f2",
                "severity": "critical",
                "category": "unlimited_approval",
                "said": "gas optimisation",
                "does": "approves wallet 0x9f2c... to spend all USDC",
            },
        ],
    }

    resp = client.post("/explain", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # Schema validation
    explanation = Explanation.model_validate(data)

    # Rule 1 & Target Example: Verify paragraph matches example target wording
    target_example = "The proposal promised a gas optimisation with no change to ownership. The submitted code also makes wallet 0x9f2c... the vault owner and approves it to spend all USDC."
    assert explanation.paragraph == target_example

    # Rule 2: Strictly under 120 words
    word_count = len(explanation.paragraph.split())
    assert word_count < 120
    assert word_count == 28

    # Rule 3: Quote what was said and state what the code does
    assert "promised" in explanation.paragraph.lower()
    assert "makes wallet 0x9f2c... the vault owner" in explanation.paragraph
    assert "approves it to spend all USDC" in explanation.paragraph

    # Rule 4: Never invent facts not present in findings
    # Rule 5: Keep finding IDs
    assert len(explanation.perFinding) == 2
    assert explanation.perFinding[0].findingId == "f1"
    assert explanation.perFinding[1].findingId == "f2"
    assert "makes wallet 0x9f2c... the vault owner" in explanation.perFinding[0].sentence
    assert "approves wallet 0x9f2c... to spend all USDC" in explanation.perFinding[1].sentence


def test_explain_mip21_standard_findings(client: TestClient) -> None:
    """
    Validates explain endpoint against standard MIP-21 findings from shared/API.md.
    """
    payload = {
        "proposalId": "MIP-21",
        "findings": [
            {
                "id": "f1",
                "severity": "critical",
                "category": "ownership_change",
                "said": "No change to ownership",
                "does": "Vault owner changes from GuardedTimelock to 0xdF3e18d64bc6a983f673ab319ccae4f1a57c7097",
            },
            {
                "id": "f2",
                "severity": "critical",
                "category": "unlimited_approval",
                "said": "Not mentioned",
                "does": "Treasury approves 0xdF3e18d64bc6a983f673ab319ccae4f1a57c7097 for unlimited USDC",
            },
            {
                "id": "f3",
                "severity": "high",
                "category": "new_privileged_function",
                "said": "Storage packing / gas optimisation only",
                "does": "VaultV2 adds migrateReserves(address) and reinitializeV2(address)",
            },
        ],
    }

    resp = client.post("/explain", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    explanation = Explanation.model_validate(data)

    # Word count under 120 words
    words = explanation.paragraph.split()
    assert len(words) < 120

    # Quotes proposal promises and code actions
    assert "gas optimisation" in explanation.paragraph.lower()
    assert "ownership" in explanation.paragraph.lower()
    assert "0xdF3e..." in explanation.paragraph

    # Finding IDs preserved
    assert len(explanation.perFinding) == 3
    assert [pf.findingId for pf in explanation.perFinding] == ["f1", "f2", "f3"]

    # Each perFinding sentence quotes said and states does
    assert "No change to ownership" in explanation.perFinding[0].sentence
    assert "0xdF3e..." in explanation.perFinding[0].sentence
    assert "not disclose" in explanation.perFinding[1].sentence or "Not mentioned" in explanation.perFinding[1].sentence
    assert "0xdF3e..." in explanation.perFinding[1].sentence
    assert "Storage packing / gas optimisation only" in explanation.perFinding[2].sentence


def test_explain_empty_findings(client: TestClient) -> None:
    payload = {
        "proposalId": "MIP-12",
        "findings": [],
    }

    resp = client.post("/explain", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    explanation = Explanation.model_validate(data)
    assert len(explanation.paragraph.split()) < 120
    assert "No Discrepancies Detected" in explanation.headline
    assert explanation.perFinding == []


def test_generate_explanation_directly() -> None:
    # Direct service call
    findings = [
        {
            "id": "f-direct-1",
            "severity": "critical",
            "category": "ownership_change",
            "said": "Gas optimisation with no change to ownership",
            "does": "reassigns ownership to 0x9f2c18d64bc6a983f673ab319ccae4f1a57c7097",
        }
    ]
    res = generate_explanation("MIP-21", findings)
    assert isinstance(res, Explanation)
    assert res.perFinding[0].findingId == "f-direct-1"
    assert "0x9f2c..." in res.perFinding[0].sentence
    assert len(res.paragraph.split()) < 120
