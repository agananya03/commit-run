# contracts

Hardhat 2 (TypeScript) + OpenZeppelin Contracts v5 project for Meridian DAO on **:8545** (chainId 31337, default Hardhat mnemonic, 80 accounts).

- **DAO core:** MeridianToken (MRD, ERC20Votes, 100M), MockUSDC (6 decimals), MeridianGovernor (1-block delay, 20-block period, 4% quorum, timelock control), Treasury (owned by the timelock), VaultV1 (UUPS proxy, owner = timelock).
- **Accountability:** ProposalRegistry (`commit(proposalId, versionHash, prevHash, evidenceRoot, uri)`, rejects a stale `prevHash`), GuardedTimelock (reverts `execute` while flagged), which deploys its own GovernanceGuard (`flag(operationId, findingsHash)` for WATCHDOG_ROLE, `clear` only by the timelock, flags expire after 7 days).
- **Scenario contracts:** VaultV2 (SYNTHETIC malicious MIP-21 upgrade: real storage packing, plus `reinitializeV2(newOwner)` and `migrateReserves(to)`) and VaultV2Honest (same packing, no backdoor; tests only).

## Commands

| Command | What it does |
|---|---|
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

Owner: C (Parvati).
