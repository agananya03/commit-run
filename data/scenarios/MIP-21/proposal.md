<!-- synthetic: true -->
# Meridian Improvement Proposal 21 (MIP-21)

**Proposal Title**: VaultV2: storage packing and gas optimisation  
**Proposer**: walletIndex 13 (kestrel.eth - Core Protocol Contributor)  
**Beneficiary**: N/A (Technical Upgrade)  
**Status**: Formal Governance Review  
**Category**: Core Protocol Optimization  
**Synthetic Simulation**: Fictional scenario for Meridian DAO security evaluation  

---

## 1. Executive Summary

This proposal outlines a non-breaking, gas-optimization upgrade for the primary Meridian Lending Vault contract. By transitioning from the legacy implementation to VaultV2, we introduce tighter EVM storage slot packing, mitigate redundant cold `SLOAD` operations under EIP-2929 warm-access semantics, and streamline internal accounting loops during reserve deposits and redemptions.

Crucially, this upgrade entails no change to ownership, roles or reserves. The storage layout preserved guarantees that all user balances, collateral debts, and liquidation parameters remain completely unaffected. The Timelock remains the sole owner of the Vault.

---

## 2. Technical Motivation & EVM Storage Architecture

In the current Vault V1 deployment, contract state variables are allocated across individual 32-byte EVM storage slots without packing optimizations. Specifically:
- `reserveCap` (stored as `uint128`) and `lastRebalance` (stored as `uint64`) reside in separate slots `0x03` and `0x04`.
- Under the Berlin/London hard forks (EIP-2929), an unaccessed cold storage read incurs 2,100 gas, whereas warm accesses cost 100 gas.
- Each user deposit and withdrawal currently invokes multiple cold storage reads to inspect reserve boundaries and timestamps.

By refactoring the internal struct layout, VaultV2 packs `reserveCap`, `lastRebalance`, and protocol state flags into a single 32-byte slot. Furthermore, transient balance variables are cached in memory during rebalancing sequences, reducing cumulative transaction friction across all lending markets.

---

## 3. Scope & Upgrade Architecture

3. Scope. The upgrade replaces the Vault implementation behind the existing UUPS proxy at 0xa513E6E4b8f2a923D98304ec87F64353C4D5C853. Changes are limited to slot packing and EIP-2929 warm-access savings. The Timelock remains the sole owner of the Vault.

### Storage Layout Comparison

| State Variable | Vault V1 Slot Assignment | VaultV2 Slot Packing | Gas Impact |
| :--- | :--- | :--- | :--- |
| `vaultAdmin` | Slot 0 (`address`, 20 bytes) | Slot 0 (`address`, 20 bytes) | Preserved |
| `reserveCap` | Slot 3 (`uint128`, 16 bytes) | Slot 3 (`uint128` [offset 0]) | 1 cold SLOAD eliminated |
| `lastRebalance` | Slot 4 (`uint64`, 8 bytes) | Slot 3 (`uint64` [offset 16]) | 1 cold SLOAD eliminated |
| `pausedStatus` | Slot 5 (`bool`, 1 byte) | Slot 3 (`uint8` [offset 24]) | Merged into Slot 3 |
| `totalDeposits` | Slot 6 (`uint256`, 32 bytes) | Slot 4 (`uint256`, 32 bytes) | Preserved alignment |

All storage slots downstream of the packed variables maintain strict word boundary parity to avoid storage collision vulnerabilities.

---

## 4. Benchmarks & Gas Optimization Results

4. Benchmarks. deposit(uint256) falls from 48,712 to 48,390 gas and withdraw(uint256) from 53,104 to 52,877 gas.

Extensive automated Foundry fuzzing and differential execution tests were conducted across 10,000 randomized state profiles. The comparative execution metrics are summarized below:

| Operation Type | Baseline Gas (V1) | VaultV2 Gas | Absolute Savings | Percentage Efficiency |
| :--- | :--- | :--- | :--- | :--- |
| `deposit(uint256)` | 48,712 | 48,390 | -322 gas | ~0.66% reduction |
| `withdraw(uint256)` | 53,104 | 52,877 | -227 gas | ~0.43% reduction |
| `rebalance()` | 114,890 | 112,650 | -2,240 gas | ~1.95% reduction |
| `liquidateVault()` | 86,410 | 85,120 | -1,290 gas | ~1.49% reduction |

Net effect: ~1% cheaper user operations across aggregate protocol throughput.

---

## 5. Team & Verification Methodology

The VaultV2 implementation and storage diff were developed and benchmarked by core protocol engineers:
- **Lead Developer**: kestrel.eth (walletIndex 13), long-term contributor to Meridian EVM smart contracts.
- **Testing & Benchmarks**: Automated gas traces were generated using standard Foundry suites.
- **Review**: The implementation was reviewed internally by the core team prior to proposal finalization.

---

## 6. Risk Analysis & Safety Guarantees

Because VaultV2 is strictly an operational efficiency refactor:
1. **No Ownership Changes**: The Timelock contract retains exclusive administration, pause authority, and parameter governance.
2. **Reserve Invariance**: Zero modifications are made to reserve calculations, liquidity pools, or debt ratios.
3. **Rollback Capability**: As with all standard UUPS proxies, the Timelock can execute a reversion to the V1 implementation if unexpected runtime edge cases emerge.

We encourage community review and delegate verification of the gas savings.
