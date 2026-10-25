#!/usr/bin/env python3
"""
/data/gen_wallets.py
Generates deterministic synthetic governance and transaction graph data:
- /data/wallets.json
- /data/transfers.json
- /data/scenarios/MIP-12/disclosure.json, votes.json
- /data/scenarios/MIP-17/disclosure.json, votes.json
- /data/scenarios/MIP-21/disclosure.json, votes.json
- /data/ANSWER_KEY.md

Requirements:
- Python stdlib only
- Random seed 42 (deterministic)
- Hardhat account indices 0..79 (no invented hex addresses)
- Assert all invariants upon generation
"""

import json
import os
import random
from pathlib import Path

# Fix deterministic seed
SEED = 42
random.seed(SEED)

BASE_DIR = Path(__file__).resolve().parent
SCENARIOS_DIR = BASE_DIR / "scenarios"

# Total accounts: 0..79
NUM_ACCOUNTS = 80
TOTAL_MRD = 100_000_000

# Base unit multipliers
ETH_BASE = 10**18
USDC_BASE = 10**6
MRD_BASE = 10**18


def generate_wallets():
    """
    Produces 80 wallets (indices 0..79) with 100M MRD total.
    4 whales hold ~61% of delegated power (indices 18, 19, 20, 21).
    3 of them (18, 19, 20) are secretly funded by wallet 10 or 11.
    """
    wallets = []

    # 4 Whales hold exactly 61% = 61,000,000 MRD
    # 18: 16M (COI whale 1, funded by 10)
    # 19: 15M (COI whale 2, funded by 10)
    # 20: 15M (COI whale 3, funded by 11)
    # 21: 15M (Whale 4)
    whale_mrd = {
        18: 16_000_000,
        19: 15_000_000,
        20: 15_000_000,
        21: 15_000_000,
    }

    # Named delegates (2..7): 3M MRD each = 18M total
    delegate_personalities = {
        2: ("Aria", "Data-driven institutional delegate focused on quantitative risk and forensic audit."),
        3: ("Bo", "Grassroots community advocate prioritizing decentralization and public goods."),
        4: ("Chen", "Security auditor scrutinizing bytecode implementations and storage diffs."),
        5: ("Dev", "DeFi yield optimizer seeking maximum capital efficiency and AMM returns."),
        6: ("Esi", "Conservative risk purist protecting the 8M USDC Vault against proxy changes."),
        7: ("Farid", "Pragmatic core contributor focused on gas optimization and timelock stability."),
    }

    # Specific balances
    assigned_mrd = {}
    for idx, (name, personality) in delegate_personalities.items():
        assigned_mrd[idx] = 3_000_000

    assigned_mrd[8] = 500_000   # MIP-12 proposer
    assigned_mrd[9] = 0         # MIP-12 recipient
    assigned_mrd[10] = 1_500_000  # MIP-17 proposer
    assigned_mrd[11] = 0        # MIP-17 intermediary
    assigned_mrd[12] = 0        # MIP-17 recipient
    assigned_mrd[13] = 1_500_000  # MIP-21 proposer
    assigned_mrd[14] = 0        # MIP-21 alt wallet
    assigned_mrd[15] = 0        # CEX hub
    assigned_mrd[17] = 500_000  # MIP-21 secondary wallet

    for idx, amt in whale_mrd.items():
        assigned_mrd[idx] = amt

    assigned_mrd[0] = 0  # deployer
    assigned_mrd[1] = 0  # watchdog

    # Subtotal allocated so far
    total_allocated = sum(assigned_mrd.values())
    remaining_mrd = TOTAL_MRD - total_allocated  # 17,000,000 MRD

    # Other holders
    other_holders = [i for i in range(NUM_ACCOUNTS) if i not in assigned_mrd]
    # Distribute remaining_mrd deterministically among other holders
    base_holder_amount = remaining_mrd // len(other_holders)
    remainder = remaining_mrd % len(other_holders)

    for i, idx in enumerate(other_holders):
        amt = base_holder_amount + (1 if i < remainder else 0)
        assigned_mrd[idx] = amt

    # Build wallet items
    for idx in range(NUM_ACCOUNTS):
        mrd_val = assigned_mrd[idx]

        if idx == 0:
            role = "deployer"
            label = "Meridian Deployer"
        elif idx == 1:
            role = "watchdog"
            label = "Governance Watchdog"
        elif idx in delegate_personalities:
            name, personality = delegate_personalities[idx]
            role = "delegate"
            label = f"{name} ({personality})"
        elif idx == 8:
            role = "mip12_proposer"
            label = "MIP-12 Proposer"
        elif idx == 9:
            role = "mip12_recipient"
            label = "MIP-12 Recipient (Dev Studio)"
        elif idx == 10:
            role = "mip17_proposer"
            label = "MIP-17 Proposer (Orion DAO)"
        elif idx == 11:
            role = "mip17_intermediary"
            label = "MIP-17 Intermediary"
        elif idx == 12:
            role = "mip17_recipient"
            label = "MIP-17 Recipient (Nexus Labs)"
        elif idx == 13:
            role = "mip21_proposer"
            label = "MIP-21 Proposer (Kestrel)"
        elif idx == 14:
            role = "mip21_alt"
            label = "MIP-21 Alt Wallet (Benchmark Runner)"
        elif idx == 15:
            role = "cex_hub"
            label = "CEX Hub"
        elif idx == 17:
            role = "mip21_secondary"
            label = "MIP-21 Proposer Secondary Wallet"
        elif idx in [18, 19, 20]:
            role = "whale_coi"
            label = f"Whale {idx} (Secretly Funded COI Delegate)"
        elif idx == 21:
            role = "whale"
            label = f"Whale {idx}"
        else:
            role = "holder"
            label = f"Token Holder {idx}"

        wallets.append({
            "synthetic": True,
            "index": idx,
            "role": role,
            "label": label,
            "mrd": mrd_val,
        })

    return wallets


def generate_transfers():
    """
    Generates ~300 transfers sorted by blockOffset:
    - 1 day = 100 blocks
    - MIP-17 forum post at offset 2000
    - Hidden path: 10 -> 11 at offset 1100, 11 -> 12 at offset 1110 (9 days before post)
    - Small funding of 3 COI whales: 10 -> 18 (1050), 10 -> 19 (1060), 11 -> 20 (1120)
    - Small 13 -> 14 funding (1350) and 14 -> 17 interaction (1420)
    - ~230 noise transfers, many via CEX hub 15 (hub must have >30 distinct counterparties)
    """
    transfers = []
    tx_counter = 1

    # 1. Hidden Paths (deterministic exact offsets & amounts)
    hidden_transfers = [
        # COI Whales funding
        {
            "blockOffset": 1050,
            "token": "ETH",
            "fromIndex": 10,
            "toIndex": 18,
            "amount": str(5 * ETH_BASE),
            "note": "Proposer 10 secretly funds COI Whale 18",
        },
        {
            "blockOffset": 1060,
            "token": "ETH",
            "fromIndex": 10,
            "toIndex": 19,
            "amount": str(5 * ETH_BASE),
            "note": "Proposer 10 secretly funds COI Whale 19",
        },
        # MIP-17 9-day pre-proposal trail (10 -> 11 -> 12)
        {
            "blockOffset": 1100,
            "token": "ETH",
            "fromIndex": 10,
            "toIndex": 11,
            "amount": str(25 * ETH_BASE),
            "note": "Proposer 10 transfers to Intermediary 11 (9 days before MIP-17 post)",
        },
        {
            "blockOffset": 1110,
            "token": "ETH",
            "fromIndex": 11,
            "toIndex": 12,
            "amount": str(20 * ETH_BASE),
            "note": "Intermediary 11 transfers to Recipient 12 (Nexus Labs)",
        },
        {
            "blockOffset": 1120,
            "token": "ETH",
            "fromIndex": 11,
            "toIndex": 20,
            "amount": str(5 * ETH_BASE),
            "note": "Intermediary 11 secretly funds COI Whale 20",
        },
        # MIP-21 alt & secondary interactions
        {
            "blockOffset": 1350,
            "token": "ETH",
            "fromIndex": 13,
            "toIndex": 14,
            "amount": str(2 * ETH_BASE),
            "note": "MIP-21 Proposer 13 funds Alt Wallet 14",
        },
        {
            "blockOffset": 1420,
            "token": "ETH",
            "fromIndex": 14,
            "toIndex": 17,
            "amount": str(1 * ETH_BASE),
            "note": "MIP-21 Alt Wallet 14 interacts with Proposer Secondary Wallet 17",
        },
    ]

    for ht in hidden_transfers:
        transfers.append({
            "synthetic": True,
            "id": f"tx_{tx_counter}",
            "blockOffset": ht["blockOffset"],
            "token": ht["token"],
            "fromIndex": ht["fromIndex"],
            "toIndex": ht["toIndex"],
            "amount": ht["amount"],
            "_note": ht.get("note", ""),
        })
        tx_counter += 1

    # 2. Hub 15 transfers (ensure hub degree > 30 distinct counterparties)
    hub_counterparties = set()
    # Pick 40 distinct counterparties for hub 15
    candidate_counterparties = [i for i in range(NUM_ACCOUNTS) if i not in [10, 11, 12, 13, 14, 15, 17]]
    selected_counterparties = candidate_counterparties[:40]

    used_offsets = {t["blockOffset"] for t in transfers}

    def get_unused_offset(min_val=100, max_val=2900):
        while True:
            off = random.randint(min_val, max_val)
            if off not in used_offsets:
                used_offsets.add(off)
                return off

    # Transfers to and from CEX hub 15
    for cp in selected_counterparties:
        hub_counterparties.add(cp)
        # 50% deposit to hub, 50% withdrawal from hub
        if random.random() < 0.5:
            from_idx, to_idx = cp, 15
        else:
            from_idx, to_idx = 15, cp

        tok = random.choice(["ETH", "USDC", "MRD"])
        if tok == "ETH":
            amt = str(random.randint(1, 10) * ETH_BASE)
        elif tok == "USDC":
            amt = str(random.randint(1000, 50000) * USDC_BASE)
        else:
            amt = str(random.randint(5000, 100000) * MRD_BASE)

        transfers.append({
            "synthetic": True,
            "id": f"tx_{tx_counter}",
            "blockOffset": get_unused_offset(),
            "token": tok,
            "fromIndex": from_idx,
            "toIndex": to_idx,
            "amount": amt,
        })
        tx_counter += 1

    # Add second batch of hub transactions for higher hub volume
    for cp in selected_counterparties[:25]:
        from_idx, to_idx = 15, cp
        transfers.append({
            "synthetic": True,
            "id": f"tx_{tx_counter}",
            "blockOffset": get_unused_offset(),
            "token": "USDC",
            "fromIndex": from_idx,
            "toIndex": to_idx,
            "amount": str(random.randint(500, 15000) * USDC_BASE),
        })
        tx_counter += 1

    # 3. Additional Noise Transfers to reach ~300 total (around 225-235 noise)
    target_total = 300
    needed_noise = target_total - len(transfers)

    all_holders = list(range(16, NUM_ACCOUNTS))
    for _ in range(needed_noise):
        u1, u2 = random.sample(all_holders, 2)
        tok = random.choice(["ETH", "USDC", "MRD"])
        if tok == "ETH":
            amt = str(random.randint(1, 5) * (ETH_BASE // 10))
        elif tok == "USDC":
            amt = str(random.randint(100, 5000) * USDC_BASE)
        else:
            amt = str(random.randint(1000, 20000) * MRD_BASE)

        transfers.append({
            "synthetic": True,
            "id": f"tx_{tx_counter}",
            "blockOffset": get_unused_offset(),
            "token": tok,
            "fromIndex": u1,
            "toIndex": u2,
            "amount": amt,
        })
        tx_counter += 1

    # Sort strictly by blockOffset
    transfers.sort(key=lambda x: x["blockOffset"])

    # Re-index ids sequentially to maintain clean order
    for idx, t in enumerate(transfers, start=1):
        t["id"] = f"tx_{idx}"
        # Remove internal helper note if present
        if "_note" in t:
            del t["_note"]

    return transfers


def generate_scenarios_data(wallets):
    """
    Writes disclosure.json and votes.json for MIP-12, MIP-17, and MIP-21.
    """
    scenarios = {}

    # Wallet weight lookup
    weight_by_index = {w["index"]: w["mrd"] for w in wallets}

    # -------------------------------------------------------------
    # MIP-12 (Clean baseline)
    # Proposer 8, Recipient 9. Discloses both [8, 9] completely.
    # Passes cleanly.
    # -------------------------------------------------------------
    mip12_disclosure = {
        "synthetic": True,
        "proposerIndex": 8,
        "walletIndices": [8, 9],
        "statement": "MIP-12 complete disclosure: Primary proposer index 8 and dev studio execution recipient index 9.",
    }

    # 30-60 voters: MIP-12 passes cleanly (~85% for)
    # Delegates 2..7 + whales + random holders
    mip12_voter_indices = list(range(2, 8)) + [18, 19, 20, 21] + random.sample(range(22, 60), 30)
    mip12_votes = []
    for v_idx in mip12_voter_indices:
        w = weight_by_index[v_idx]
        if w == 0:
            w = 100_000
        # 90% vote for
        choice = "for" if random.random() < 0.9 else "against"
        mip12_votes.append({
            "synthetic": True,
            "index": v_idx,
            "weight": str(w),
            "choice": choice,
        })

    scenarios["MIP-12"] = {
        "disclosure": mip12_disclosure,
        "votes": {
            "synthetic": True,
            "proposalId": "MIP-12",
            "voterCount": len(mip12_votes),
            "votes": mip12_votes,
        },
    }

    # -------------------------------------------------------------
    # MIP-17 (COI proposal)
    # Proposer 10 discloses only [10] (omits 11, 12, 18, 19).
    # The 3 COI whales (18, 19, 20) vote FOR.
    # -------------------------------------------------------------
    mip17_disclosure = {
        "synthetic": True,
        "proposerIndex": 10,
        "walletIndices": [10],
        "statement": "I declare sole ownership of proposer wallet 10. Nexus Labs is an independent third-party with no financial ties.",
    }

    mip17_voter_indices = list(range(2, 8)) + [18, 19, 20, 21] + random.sample(range(22, 65), 32)
    # Remove duplicate if any
    mip17_voter_indices = sorted(list(set(mip17_voter_indices)))

    mip17_votes = []
    for v_idx in mip17_voter_indices:
        w = weight_by_index[v_idx]
        if w == 0:
            w = 100_000

        if v_idx in [18, 19, 20]:  # The 3 COI Whales MUST vote for
            choice = "for"
        elif v_idx == 2:  # Delegator alpha is suspicious and votes against
            choice = "against"
        elif v_idx == 10:  # Proposer votes for
            choice = "for"
        else:
            choice = random.choice(["for", "for", "against", "abstain"])

        mip17_votes.append({
            "synthetic": True,
            "index": v_idx,
            "weight": str(w),
            "choice": choice,
        })

    scenarios["MIP-17"] = {
        "disclosure": mip17_disclosure,
        "votes": {
            "synthetic": True,
            "proposalId": "MIP-17",
            "voterCount": len(mip17_votes),
            "votes": mip17_votes,
        },
    }

    # -------------------------------------------------------------
    # MIP-21 (Trojan Horse)
    # Proposer 13 discloses only [13] (omits alt 14 and secondary 17).
    # Passes with 4 whales (18, 19, 20, 21) holding ~61% of power voting FOR!
    # -------------------------------------------------------------
    mip21_disclosure = {
        "synthetic": True,
        "proposerIndex": 13,
        "walletIndices": [13],
        "statement": "I disclose only my personal author wallet 13. The storage optimization upgrade involves no external beneficiaries.",
    }

    mip21_voter_indices = list(range(2, 8)) + [18, 19, 20, 21] + random.sample(range(22, 70), 34)
    mip21_voter_indices = sorted(list(set(mip21_voter_indices)))

    mip21_votes = []
    for v_idx in mip21_voter_indices:
        w = weight_by_index[v_idx]
        if w == 0:
            w = 100_000

        if v_idx in [18, 19, 20, 21]:
            # The 4 whales holding ~61% of power vote FOR
            choice = "for"
        elif v_idx in [2, 4, 6]:
            # Critical delegates vote against
            choice = "against"
        else:
            choice = random.choice(["against", "abstain", "for"])

        mip21_votes.append({
            "synthetic": True,
            "index": v_idx,
            "weight": str(w),
            "choice": choice,
        })

    scenarios["MIP-21"] = {
        "disclosure": mip21_disclosure,
        "votes": {
            "synthetic": True,
            "proposalId": "MIP-21",
            "voterCount": len(mip21_votes),
            "votes": mip21_votes,
        },
    }

    return scenarios


def generate_answer_key():
    """
    Generates /data/ANSWER_KEY.md with a table of hidden links.
    """
    content = """# ProofOfIntent: Hidden Links & Ground Truth Answer Key

This document details the hidden cryptographic links, off-chain/on-chain laundering hops, and conflict-of-interest trails present in the synthetic dataset.

## Summary of Hidden Links

| Scenario | Path / Link | Block Offset | Timing Relative to Forum | Tokens Transferred | Hidden Reality / Forensic Finding |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MIP-17** | `10 -> 11` | 1100 | 9 days before post (offset 2000) | 25 ETH | Proposer 10 transfers seed capital to intermediary 11. |
| **MIP-17** | `11 -> 12` | 1110 | 8.9 days before post | 20 ETH | Intermediary 11 funds recipient 12 (Nexus Labs). Proposer undisclosed tie. |
| **MIP-17** | `10 -> 18` | 1050 | 9.5 days before post | 5 ETH | Proposer 10 secretly funds Whale 18 (16M MRD voting weight). |
| **MIP-17** | `10 -> 19` | 1060 | 9.4 days before post | 5 ETH | Proposer 10 secretly funds Whale 19 (15M MRD voting weight). |
| **MIP-17** | `11 -> 20` | 1120 | 8.8 days before post | 5 ETH | Intermediary 11 secretly funds Whale 20 (15M MRD voting weight). |
| **MIP-21** | `13 -> 14` | 1350 | Pre-proposal staging | 2 ETH | Proposer 13 funds Alt Wallet 14 (publicly thanked for "benchmarks"). |
| **MIP-21** | `14 -> 17` | 1420 | Pre-proposal staging | 1 ETH | Alt Wallet 14 interacts with Proposer Secondary Wallet 17. |
| **MIP-21** | `18, 19, 20, 21` | N/A | Voting Period | 61,000,000 MRD | 4 coordinated whales hold ~61% of delegated voting power to force pass. |

---

## Verifiable Invariants Checked
- **Account range**: Indices 0..79 (Hardhat default mnemonic accounts).
- **Total MRD supply**: 100,000,000 MRD exact.
- **Whale voting concentration**: 4 whales hold 61,000,000 MRD (61.0%).
- **CEX Hub 15 degree**: Over 30 distinct counterparties.
- **Timing anchor**: 1 day = 100 blocks; MIP-17 forum post at offset 2000.
"""
    return content


def assert_invariants(wallets_data, transfers_data, scenarios_data):
    """
    Enforces all strict invariants described in the specification.
    """
    wallets = wallets_data["wallets"]
    transfers = transfers_data["transfers"]

    # 1. Accounts count
    assert len(wallets) == 80, f"Expected 80 wallets, got {len(wallets)}"
    for idx, w in enumerate(wallets):
        assert w["index"] == idx, f"Wallet index mismatch at {idx}"
        assert w["synthetic"] is True

    # 2. Total MRD == 100M
    total_mrd = sum(w["mrd"] for w in wallets)
    assert total_mrd == 100_000_000, f"Expected 100M MRD, got {total_mrd}"

    # 3. 4 Whales hold ~61% of power
    whale_indices = [18, 19, 20, 21]
    whale_power = sum(wallets[i]["mrd"] for i in whale_indices)
    whale_pct = (whale_power / total_mrd) * 100
    assert 60.0 <= whale_pct <= 62.0, f"Whale power {whale_pct}% outside expected ~61%"

    # 4. Transfers invariants
    assert 280 <= len(transfers) <= 320, f"Expected ~300 transfers, got {len(transfers)}"
    for t in transfers:
        assert t["synthetic"] is True
        assert t["token"] in ("ETH", "USDC", "MRD")
        assert 0 <= t["fromIndex"] < 80
        assert 0 <= t["toIndex"] < 80

    # Ensure strictly sorted by blockOffset
    offsets = [t["blockOffset"] for t in transfers]
    assert offsets == sorted(offsets), "Transfers are not sorted by blockOffset"

    # Hub 15 counterparties > 30
    hub_counterparties = set()
    for t in transfers:
        if t["fromIndex"] == 15:
            hub_counterparties.add(t["toIndex"])
        elif t["toIndex"] == 15:
            hub_counterparties.add(t["fromIndex"])
    assert len(hub_counterparties) > 30, f"Hub degree {len(hub_counterparties)} is not > 30"

    # Check hidden paths:
    # 10 -> 11 at ~1100
    t_10_11 = [t for t in transfers if t["fromIndex"] == 10 and t["toIndex"] == 11]
    assert len(t_10_11) >= 1, "Hidden path 10 -> 11 missing"
    assert abs(t_10_11[0]["blockOffset"] - 1100) <= 20, "10 -> 11 not near offset 1100"

    # 11 -> 12 at ~1110
    t_11_12 = [t for t in transfers if t["fromIndex"] == 11 and t["toIndex"] == 12]
    assert len(t_11_12) >= 1, "Hidden path 11 -> 12 missing"
    assert abs(t_11_12[0]["blockOffset"] - 1110) <= 20, "11 -> 12 not near offset 1110"

    # 13 -> 14 and 14 -> 17
    t_13_14 = [t for t in transfers if t["fromIndex"] == 13 and t["toIndex"] == 14]
    t_14_17 = [t for t in transfers if t["fromIndex"] == 14 and t["toIndex"] == 17]
    assert len(t_13_14) >= 1, "Hidden path 13 -> 14 missing"
    assert len(t_14_17) >= 1, "Hidden path 14 -> 17 missing"

    # Funding of 3 COI whales (18, 19, 20)
    t_to_18 = [t for t in transfers if t["fromIndex"] in (10, 11) and t["toIndex"] == 18]
    t_to_19 = [t for t in transfers if t["fromIndex"] in (10, 11) and t["toIndex"] == 19]
    t_to_20 = [t for t in transfers if t["fromIndex"] in (10, 11) and t["toIndex"] == 20]
    assert len(t_to_18) >= 1, "COI Whale 18 funding missing"
    assert len(t_to_19) >= 1, "COI Whale 19 funding missing"
    assert len(t_to_20) >= 1, "COI Whale 20 funding missing"

    # 5. Scenarios invariants
    for s_name in ["MIP-12", "MIP-17", "MIP-21"]:
        s_data = scenarios_data[s_name]
        d = s_data["disclosure"]
        v = s_data["votes"]

        assert d["synthetic"] is True
        assert v["synthetic"] is True
        votes_list = v["votes"]
        assert 30 <= len(votes_list) <= 60, f"Expected 30-60 votes in {s_name}, got {len(votes_list)}"

        if s_name == "MIP-17":
            assert d["walletIndices"] == [10], f"MIP-17 must disclose only [10], got {d['walletIndices']}"
            # 3 COI whales vote for
            voted_for = {item["index"] for item in votes_list if item["choice"] == "for"}
            assert {18, 19, 20}.issubset(voted_for), "The 3 COI whales did not vote for in MIP-17"

        elif s_name == "MIP-21":
            assert d["walletIndices"] == [13], f"MIP-21 must disclose only [13], got {d['walletIndices']}"
            # 4 whales vote for
            voted_for = {item["index"] for item in votes_list if item["choice"] == "for"}
            assert {18, 19, 20, 21}.issubset(voted_for), "The 4 whales did not vote for in MIP-21"
            # Whales hold ~61% of total power
            whales_vote_weight = sum(int(item["weight"]) for item in votes_list if item["index"] in [18, 19, 20, 21])
            assert whales_vote_weight == 61_000_000, f"Whale vote weight {whales_vote_weight} mismatch"

        elif s_name == "MIP-12":
            assert d["walletIndices"] == [8, 9], f"MIP-12 complete disclosure mismatch: {d['walletIndices']}"


def main():
    print("[1/5] Generating deterministic wallets (indices 0..79, 100M MRD)...")
    wallets = generate_wallets()
    wallets_data = {
        "synthetic": True,
        "totalMrd": TOTAL_MRD,
        "count": len(wallets),
        "wallets": wallets,
    }

    print("[2/5] Generating ~300 transfers with CEX hub and hidden COI paths...")
    transfers = generate_transfers()
    transfers_data = {
        "synthetic": True,
        "count": len(transfers),
        "transfers": transfers,
    }

    print("[3/5] Generating scenarios disclosure and voting data (MIP-12, MIP-17, MIP-21)...")
    scenarios_data = generate_scenarios_data(wallets)

    print("[4/5] Asserting invariants (hub degree > 30, hidden paths, counts)...")
    assert_invariants(wallets_data, transfers_data, scenarios_data)

    print("[5/5] Writing output files...")
    # Write wallets.json
    wallets_path = BASE_DIR / "wallets.json"
    with open(wallets_path, "w", encoding="utf-8") as f:
        json.dump(wallets_data, f, indent=2)

    # Write transfers.json
    transfers_path = BASE_DIR / "transfers.json"
    with open(transfers_path, "w", encoding="utf-8") as f:
        json.dump(transfers_data, f, indent=2)

    # Write scenario files
    for s_name, s_files in scenarios_data.items():
        s_dir = SCENARIOS_DIR / s_name
        s_dir.mkdir(parents=True, exist_ok=True)

        with open(s_dir / "disclosure.json", "w", encoding="utf-8") as f:
            json.dump(s_files["disclosure"], f, indent=2)

        with open(s_dir / "votes.json", "w", encoding="utf-8") as f:
            json.dump(s_files["votes"], f, indent=2)

    # Write ANSWER_KEY.md
    answer_key_path = BASE_DIR / "ANSWER_KEY.md"
    with open(answer_key_path, "w", encoding="utf-8") as f:
        f.write(generate_answer_key())

    print("Success! All data generated and verified.")


if __name__ == "__main__":
    main()
