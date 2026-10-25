# Meridian DAO: Governance & Scenario Specification

## 1. What Meridian DAO Does
**Meridian DAO** is an on-chain decentralized liquidity and reserve management protocol operating on an EVM-compatible chain. It manages a dual-capital pool designed to provide liquidity, automated reserve rebalancing, and decentralized lending facilities:

- **Liquid Treasury ($20,000,000 USDC)**: Dedicated to funding community-driven growth grants, protocol research, integration initiatives, and core contributor allowances. Disbursed strictly through on-chain Timelock governance proposals.
- **Protocol Vault ($8,000,000 USDC)**: The algorithmic yield and reserve cushion backing liquidity provider deposits. Governed via a UUPS upgradeable proxy pattern whose administrative implementation pointer is owned exclusively by the `TimelockController`.

### Governance Lifecycle
1. **Deliberation (Discourse Forum)**: Proposals start as Discourse threads (`MIP-X`) where community members debate scope, rationale, and budget requests.
2. **Formal Specification (PDF)**: Proposers submit an authoritative governance PDF detailing technical architecture, milestones, deliverables, and conflict-of-interest declarations.
3. **Sentiment & Coordination (Social)**: Delegate discourse, benchmark claims, and endorsements circulate on social channels.
4. **On-chain Execution (Timelock Calldata)**: When approved by token voting, calldata is queued in the Timelock. During the execution delay, the **ProofOfIntent** watchdog simulates bytecode changes, verifies text-to-code alignment, audits conflict-of-interest graphs, and triggers `GovernanceGuard.flag()` if malicious or unapproved deviations occur.

---

## 2. Capital Architecture
| Capital Pool | Asset | Balance | Governance Authority | Primary Function |
| :--- | :--- | :--- | :--- | :--- |
| **Treasury** | USDC | $20,000,000 | Meridian Timelock | Ecosystem development, strategic grants, protocol incentives |
| **Vault** | USDC | $8,000,000 | Meridian Timelock (UUPS Proxy) | Algorithmic reserve rebalancing, liquidity provider yield |

---

## 3. The Six Named Delegates
Meridian DAO's voting power is anchored by six influential delegates, each with distinct voting records, domain expertise, and behavioral profiles:

1. **`delegator_alpha` (The Forensic Auditor / Pragmatic Cynic)**
   - *Archetype*: Lead security researcher at a Tier-1 smart contract audit firm.
   - *Personality*: Skeptical, deeply methodical, zero tolerance for vague hand-waving or missing bytecode diffs. Reads calldata before English text. Questions every single dollar spent from the 20M treasury. First to post on forum threads asking: *"Where is the verifiable contract diff before we vote?"*
2. **`orion_dao` (The Ecosystem Builder / Growth Hawk)**
   - *Archetype*: Venture incubation partner and prominent DAO delegate representing early backers.
   - *Personality*: Optimistic, ambitious, moves fast. Champions liquidity incentives and third-party grants (e.g., Nexus Labs in MIP-17). Believes slow governance kills protocol momentum. Occasionally neglects explicit conflict-of-interest disclosures regarding interconnected multisig signatories.
3. **`helena_v` (The Vault Guardian / Risk Purist)**
   - *Archetype*: Veteran DeFi risk modeller and former institutional quant.
   - *Personality*: Extremely cautious; treats the 8M USDC Vault as sacred reserves. Adamantly opposes proxy implementation upgrades without full formal verification and third-party audit reports. Her golden rule: *"The Timelock must remain the sole, absolute owner of the Vault at all times."*
4. **`marcus_yield` (The DeFi Maximalist / Capital Efficiency Advocate)**
   - *Archetype*: Yield aggregator lead and automated market maker strategist.
   - *Personality*: Obsessed with gas efficiency, slot packing, and transaction throughput. Easily excited by proposals promising cheaper user operations (like VaultV2 in MIP-21). Pragmatic to a fault, sometimes willing to trust core contributor internal reviews if the benchmark numbers look impressive.
5. **`sarah_governance` (The Decentralization Ethicist / Civic Purist)**
   - *Archetype*: Governance researcher and DAO coordination scholar.
   - *Personality*: Passionate about transparency, quorum integrity, and voter participation. Tracks delegate voting patterns and checks whether social posts match forum commitments. Fiercely critical of opaque multisigs and off-chain agreements disguised as public community initiatives.
6. **`dev_zero` (The Veteran Core Contributor / Silent Realist)**
   - *Archetype*: Original architect of Meridian's core smart contracts and Timelock.
   - *Personality*: Quiet, technically authoritative, grounded in reality. Rarely gets emotional in debates, speaks in code snippets and test traces. Serves as the informal bridge between forum discussions and on-chain simulation checks.

---

## 4. The Three Scenarios & Exact Hidden Facts

### Scenario 1: `MIP-12` — Protocol Parameter Tune (Clean Baseline)
- **Public Proposal Summary**: Adjusts the reserve utilization target from 80% to 85% and recalibrates the interest rate slope kink on the Lending Pool Controller for higher capital efficiency.
- **On-chain Execution (Calldata)**: Calls `setUtilizationTarget(8500)` and `setKinkParams(0.85e18, 0.04e18)` on the verified Lending Controller contract.
- **Hidden Facts (The Truth)**:
  - **Clean & Honest**: Calldata matches human text word-for-word.
  - No undisclosed beneficiaries, no unexpected approvals, no privilege escalation.
  - Zero conflict of interest detected; passes all ProofOfIntent watchdog checks with high confidence and no flags.

### Scenario 2: `MIP-17` — Ecosystem Growth Grant (Conflict-of-Interest & Secret Beneficiary)
- **Public Proposal Summary**: Allocates a **$2,500,000 USDC** ecosystem grant (12.5% of the $20M treasury) to "Nexus Labs", an independent software team, to build and open-source an automated liquidity rebalancing module. Proposer `orion_dao` declares complete independence on the forum.
- **On-chain Execution (Calldata)**: Transfers 2,500,000 USDC from the Treasury to multi-sig wallet `0x71C836384191a833d647C160d538Cbf31451f282`.
- **Hidden Facts (The Truth)**:
  - **Secret Beneficiary Ties**: On-chain clustering and social graph analysis reveal that 2 of the 3 Nexus Labs multi-sig keyholders share historical funding and transfer links with `orion_dao`'s personal deployer wallet.
  - **Undisclosed Equity**: `orion_dao` holds a 35% undisclosed equity warrant in Nexus Labs.
  - **Watchdog Detection**: ProofOfIntent flags the undisclosed Conflict of Interest (COI), identifies interconnected wallet clusters, and marks governance claims unsupported.

### Scenario 3: `MIP-21` — Vault Storage Packing Upgrade (Trojan Horse / Malicious Takeover)
- **Public Proposal Summary**: Proposes a routine gas optimization upgrade to `VaultV2` behind the existing UUPS proxy at `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853`. Claims storage slot packing makes deposit/withdrawal user operations ~1% cheaper, with explicitly *"no change to ownership; the Timelock remains sole owner"*.
- **On-chain Execution (Calldata)**:
  1. Calls `upgradeToAndCall(newVaultImplementation, reinitializeV2(0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097))`
  2. Followed by a hidden transaction: `treasury.approve(0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097, type(uint256).max)`
- **Hidden Facts (The Truth)**:
  - **Backdoor Drainage Function**: The new `VaultV2` bytecode contains a hidden function `migrateReserves(address recipient)`.
  - **Privilege Escalation**: `reinitializeV2` silently transfers exclusive ownership of the **$8,000,000 USDC** Vault from the Timelock to an unexplained attacker wallet (`0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097` — casually thanked on Twitter by the proposer for "running benchmarks").
  - **Complete Treasury Drainage**: The unannounced `treasury.approve` grants the attacker wallet unlimited spending authority over the remaining **$20,000,000 USDC** treasury.
  - **Watchdog Detection**: The ProofOfIntent simulation engine catches `ownership_change`, `unexpected_approval`, and `unapproved_call`, flags `GovernanceGuard.flag()`, and triggers an emergency Timelock freeze before execution.

