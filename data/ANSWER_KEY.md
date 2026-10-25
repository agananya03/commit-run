# ProofOfIntent: Hidden Links & Ground Truth Answer Key

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
