# contracts

Hardhat 2 (TypeScript) + OpenZeppelin Contracts v5 project for Meridian DAO on **:8545** (chainId 31337, default Hardhat mnemonic, 80 accounts).

## The contracts

### DAO core

| Contract | What it is |
|---|---|
| **MeridianToken** (MRD) | ERC20Votes governance token, 100M supply minted to the deployer. Voting power counts only once delegated (deploy:seed delegates every holder). |
| **MockUSDC** | 6-decimal ERC-20 the deployer can mint. Treasury holds 20M, the vault 8M. |
| **MeridianGovernor** | OpenZeppelin Governor with a 1-block voting delay, 20-block voting period, 4% quorum, no proposal threshold, and GovernorTimelockControl. A passed proposal is queued in the GuardedTimelock, and the timelock executes it. **No proposal without evidence and a disclosure:** plain `propose` reverts `EvidenceRequired`; `proposeWithEvidence(..., evidenceRoot, disclosedWallets, disclosureUri)` records the proposer's own wallet disclosure (sent from their wallet, so the transaction is the signature) and appends `evidence: <root>` to the description, so the proposal id the DAO votes on is a hash of the evidence (`EvidenceBound` event, `evidenceOf(proposalId)`). |
| **Treasury** | Owned by the timelock. `transfer(token, to, amount)` and `approve(token, spender, amount)` are owner-only, so only a passed vote moves funds. |
| **VaultV1** (behind **VaultProxy**) | UUPS-upgradeable USDC vault with deposits, withdrawals and a deposit cap. Owner is the timelock, so only a vote can upgrade it. |

### Accountability

| Contract | What it is |
|---|---|
| **ProposalRegistry** | Append-only, hash-chained history of proposal versions. `commit(proposalId, versionHash, prevHash, evidenceRoot, uri)` must name the current latest hash as `prevHash` (`StalePrevHash` otherwise), so history can be extended but never rewritten or forked. Whoever commits version 1 owns that chain (`NotCommitter`). The backend commits every evidence version here from Hardhat #0. Beside the versions sits an assessment log: `attest(proposalId, reportHash, simHash, uri)` records the sha256 of a technical assessment (the backend's Seatbelt-style simulation report) with its attester, once at the verdict step and once for the exact queued payload (`AssessmentAttested`, `getAssessment`). |
| **GuardedTimelock** | OpenZeppelin TimelockController (60 s min delay in the demo, `TIMELOCK_DELAY`) whose `execute`/`executeBatch` revert `GuardFlagged(id)` while the guard has the operation flagged. It deploys its own GovernanceGuard in its constructor, so the guard is bound to it from block one. The governor is the only proposer and canceller, anyone can execute, and the deployer renounces admin. |
| **GovernanceGuard** | The watchdog's brake, which can only **delay**, never execute or change anything. `flag(operationId, findingsHash)` is restricted to `WATCHDOG_ROLE` (Hardhat #1, the backend's watchdog key), once per operation, and expires after `FLAG_TTL` = 7 days, so a rogue watchdog cannot block forever. `clear(operationId)` accepts only the timelock itself, so lifting a flag takes a passed governance vote. A cleared operation can never be flagged again (`AlreadyCleared`), which makes the override final. Only governance (the timelock is admin) can add or remove watchdogs. `findingsHash` is the keccak of the backend's canonical findings, so anyone can check what the flag was based on. |

### Scenario contracts (SYNTHETIC)

| Contract | What it is |
|---|---|
| **VaultV2** | The malicious MIP-21 upgrade. The storage packing it advertises is real (VaultPackedBase), but `reinitializeV2(newOwner)` also hands vault ownership to `newOwner`, and `migrateReserves(to)` lets that owner drain every USDC in the vault. Deployed by the MIP-21 proposer (#13). The watchdog catches it by behaviour in simulation (owner change, new privileged selectors), not by these names. |
| **VaultV2Honest** | Same packing, no backdoor. Used only in tests, to show an honest upgrade passes. |

## Halt and override

When a proposal is queued, the backend's watchdog re-simulates **exactly the queued calldata** (read back from the timelock's `CallScheduled` logs), scores it, and flags it before the 60 s delay runs out if the verdict is *halt*. The token holders keep the last word: an override proposal calling `guard.clear(operationId)` goes through the same vote and delay, and once it executes the original proposal can execute too.

```mermaid
sequenceDiagram
    autonumber
    actor P as Proposer (#13)
    actor H as Token holders
    participant G as MeridianGovernor
    participant T as GuardedTimelock
    participant GG as GovernanceGuard
    participant B as Backend listener + watchdog
    participant S as Sim (Anvil fork)

    P->>G: proposeWithEvidence(targets, values, calldatas, "# MIP-21: ...", evidenceRoot, [#13], disclosureUri)
    G-->>B: EvidenceBound (root = the committed evidenceRoot; disclosure omits alt wallet #14)
    G-->>B: ProposalCreated (linked by slug, operationId precomputed)
    H->>G: castVote (all in one block)
    H->>G: queue(...)
    G->>T: scheduleBatch(..., delay 60 s)
    T-->>B: CallScheduled(operationId, index, target, value, data)
    B->>T: read every CallScheduled for operationId
    B->>S: simulate queued payloads at the queue block
    S-->>B: state diffs, owner/role/allowance changes, new selectors
    B->>B: findings vs. stated intent, then risk chain (claims, COI, voting, execution)
    alt verdict is halt (CRITICAL)
        B->>GG: flag(operationId, findingsHash) from watchdog #1
        GG-->>B: Flagged, then status HALTED and socket watchdog:flag
        Note over T: 60 s delay ends
        H->>G: execute(...)
        G->>T: executeBatch(...)
        T->>GG: isFlagged(operationId)?
        GG-->>T: true
        T-->>H: revert GuardFlagged(operationId)
        Note over H,GG: Override: token holders can overrule the watchdog
        H->>G: proposeWithEvidence([guard], [0], [clear(operationId)], "# Override: ... MIP 21 ...", root of the description, [], "")
        H->>G: castVote, then queue, then 60 s delay
        H->>G: execute override
        G->>T: executeBatch
        T->>GG: clear(operationId) (msg.sender is the timelock)
        GG-->>B: Cleared, then status QUEUED
        H->>G: execute(...) original proposal
        G->>T: executeBatch, now passes the guard
    else verdict is clear or review
        Note over B,T: no flag; executes normally after the delay
    end
```

The override's description says `MIP 21` (no dash) on purpose: the backend links Governor proposals to its records by a `MIP-21`-style slug, and the override must not be mistaken for MIP-21 itself. `test/HaltOverride.e2e.test.ts` runs this whole sequence with the real MIP-21 payload.

## Commands

| Command | What it does |
|---|---|
| `bash scripts/reset.sh` | **Demo reset** (about 65 s): restarts the node and the Anvil fork, runs deploy:seed, executes MIP-12, leaves MIP-17 voted and Active, leaves MIP-21 un-proposed, re-forks the sim, then prints every address and the live MIP-21 commands. Git Bash on Windows, or bash on macOS/Linux. Logs go to `$TMPDIR/poi-reset/`. |
| `npm run node` | Hardhat node on :8545 |
| `npm run deploy:seed` | Deploy everything to the running node, seed wallets, replay transfers, write `deployments/localhost.json` |
| `npm test` | All contract tests |
| `npm run fork` | Anvil fork of :8545 on :8546 (for /sim; needs Foundry) |

`deploy:seed` deploys from Hardhat #0 in a fixed order, so addresses are deterministic on a fresh node:

| Contract | Address |
|---|---|
| MeridianToken | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| MockUSDC | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| GuardedTimelock | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| GovernanceGuard (created by the timelock) | `0x75537828f2ce51be7289709686A69CbFDbB714F1` |
| MeridianGovernor | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| Treasury (20M USDC) | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| VaultV1 implementation | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| VaultProxy (8M USDC) | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| ProposalRegistry | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| VaultV2 (deployed by Hardhat #13, the MIP-21 proposer) | `0x17F24D3b8Bc1150553b54Da30B4d993AcB889212` |

Env options: `TIMELOCK_DELAY` (seconds, default 60), `SEED_WALLETS` / `SEED_TRANSFERS` (override the /data paths), `CHAIN_START_DATE` (ISO date, set when starting `npm run node`) starts the chain clock earlier so transfers in `transfers.json` can carry historic `timestamp`s.

`deployments/localhost.json` has the shape of `Deployments` in `/shared/schemas/types.ts`: `{ chainId, deployBlock, contracts: { <Name>: { address, abi, decimals? } } }`. `VaultProxy` carries the VaultV1 ABI.

## Seed data format

`deploy:seed` reads two files owned by D, produced by `data/gen_wallets.py`. Until they exist, it uses the SYNTHETIC fallback in `scripts/seed/fallback-*.json` (same format) and prints a warning. Both are validated with zod (`scripts/seed/format.ts`); extra fields (`synthetic`, `totalMrd`, `count`, notes) are ignored. Accounts are **Hardhat account indexes 0–79** of the default mnemonic, never raw addresses.

### `/data/wallets.json`

```json
{
  "synthetic": true,
  "wallets": [
    { "index": 2, "role": "delegate", "label": "Aria", "mrd": 3000000 },
    { "index": 13, "role": "mip21_proposer", "label": "MIP-21 Proposer (Kestrel)", "mrd": 1500000 },
    { "index": 14, "role": "mip21_alt", "label": "MIP-21 alt wallet", "mrd": 0 }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `index` | yes | Hardhat account 0–79, unique |
| `role` | yes | free text, e.g. deployer, watchdog, delegate, mip17_intermediary, cex_hub, whale_coi, holder |
| `label` | no | display name |
| `mrd` | no | whole MRD sent from the deployer at seed time (number, or decimal string for fractions) |
| `usdc` | no | whole USDC minted to the account at seed time |
| `delegateTo` | no | index that receives this account's voting power; defaults to itself. Only applies when `mrd` > 0 |

### `/data/transfers.json`

```json
{
  "synthetic": true,
  "transfers": [
    { "id": "tx_90", "blockOffset": 1100, "token": "ETH", "fromIndex": 10, "toIndex": 11, "amount": "25000000000000000000" },
    { "id": "tx_1", "blockOffset": 101, "token": "USDC", "fromIndex": 38, "toIndex": 54, "amount": "4588000000" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `fromIndex`, `toIndex` | yes | Hardhat account indexes |
| `token` | yes | `ETH`, `USDC` or `MRD` |
| `amount` | yes | **base units** as an integer string: 6 decimals for USDC (`"4588000000"` = 4,588 USDC), 18 for MRD and ETH |
| `blockOffset` | yes | replay order; empty blocks are mined so the transfer lands this many blocks after the replay starts |
| `id` | no | shown in errors and logs |
| `timestamp` | no | exact block time (ISO 8601); must be later than the chain's latest block |

### Replay rules

- Transfers replay in `blockOffset` order (file order breaks ties), each from the sender's own account. Every account starts with 10,000 ETH.
- **Pre-funding.** Before replaying, the script dry-runs the history and covers balances the data assumes but never creates (e.g. a hub sending USDC it never received). USDC is **minted** to the sender, so it comes from `0x0` and adds no wallet link. MRD has a fixed 100M supply, so the deployer sends it, held back from the largest allocation when the whole supply is handed out. With D's current data that is 506,721 USDC for 41 senders and 172,779 MRD for the CEX hub (#15) and the watchdog (#1), held back from whale #18 (−1.1%). The deploy log prints the totals.
- The deployer keeps any MRD that is not handed out and does not delegate it.

## Governance flow (`scripts/governance.ts`)

Drives a scenario from `/data/scenarios/<id>/` through propose → vote → queue → execute on the local node. Calldata is encoded from `onchain_actions.json` with the deployed ABIs (`scripts/lib/actions.ts`), the proposer comes from `disclosure.json` (`proposerIndex`), and votes from `votes.json`.

| Command | What it does |
|---|---|
| `npm run gov -- propose MIP-21` | propose from the scenario's proposer with `proposeWithEvidence`: the evidence root of `data/scenarios/MIP-21` and the wallets in its `disclosure.json` (`scripts/lib/evidence.ts`); prints `governorProposalId` and the `targets/values/calldatas` JSON |
| `npm run gov -- vote MIP-21` | cast every vote in `votes.json`, all mined in **one block** (40+ voters would otherwise outlast the 20-block voting period) |
| `npm run gov -- advance [blocks] [seconds]` | mine blocks / move time (default: voting period + 1 block) |
| `npm run gov -- queue MIP-21` | queue in the GuardedTimelock; prints the operation id |
| `npm run gov -- execute MIP-21` | execute after the delay; prints `HALTED` if GovernanceGuard flagged it |
| `npm run gov -- status MIP-21` | on-chain state |
| `npm run gov -- open MIP-17` | propose, wait out the voting delay and vote; leaves it Active |
| `npm run gov -- override MIP-21` | token holders overrule a watchdog flag: propose `guard.clear(operationId)`, vote, queue, execute it, then execute MIP-21 |
| `npm run gov -- addresses` | every deployed address plus the demo accounts (#0, #1, #13, #14) |
| `npm run flow MIP-12` | everything above, resuming from the proposal's current state |
| `npm run gov -- flow MIP-12 + open MIP-17` | several commands in one process, in order (reset.sh uses this) |

The description is `# <slug>: <forum title>`, derived from `/data` every time, so queue and execute always match the proposal; the backend links chain proposals to its records by the slug in it.

Owner: C (Parvati).
