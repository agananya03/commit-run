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

`deploy:seed` reads two files owned by D. Until they exist, it uses the SYNTHETIC fallback in `scripts/seed/fallback-*.json` and prints a warning. Both are validated with zod (`scripts/seed/format.ts`); extra fields are ignored, so add notes freely. Accounts are **Hardhat account indexes 0–79** of the default mnemonic, never raw addresses.

### `/data/wallets.json`

```json
{
  "wallets": [
    { "index": 2, "role": "delegate", "label": "atlas.eth", "mrd": "2000000" },
    { "index": 13, "role": "proposer", "label": "kestrel.eth", "mrd": "400000", "usdc": "20000" },
    { "index": 14, "role": "alt_wallet", "label": "MIP-21 alt wallet" },
    { "index": 20, "role": "holder", "mrd": "50000", "delegateTo": 2 }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `index` | yes | Hardhat account 0–79, unique |
| `role` | yes | free text, e.g. deployer, watchdog, delegate, proposer, intermediary, recipient, alt_wallet, hub, holder |
| `label` | no | display name |
| `mrd` | no | whole MRD sent from the deployer at seed time (decimal string) |
| `usdc` | no | USDC minted to the account at seed time (decimal string) |
| `delegateTo` | no | index that receives this account's voting power; defaults to itself. Only applies when `mrd` is set |

The deployer keeps whatever MRD is not handed out (100M total) and does not delegate it.

### `/data/transfers.json`

```json
{
  "transfers": [
    { "from": 10, "to": 11, "token": "ETH", "amount": "2", "blockOffset": 5 },
    { "from": 11, "to": 12, "token": "USDC", "amount": "39000", "blockOffset": 8 },
    { "from": 13, "to": 14, "token": "MRD", "amount": "10000", "blockOffset": 12, "timestamp": "2026-10-11T09:00:00Z" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `from`, `to` | yes | Hardhat account indexes |
| `token` | yes | `ETH`, `USDC` or `MRD` |
| `amount` | yes | human units as a decimal string (`"1.9"`, `"39000"`) |
| `blockOffset` | yes | replay order; empty blocks are mined so the transfer lands at least this many blocks after the replay starts |
| `timestamp` | no | exact block time (ISO 8601); must be later than the chain's latest block |

Rules: transfers replay in `blockOffset` order, from the sender's own account. A transfer the sender can't afford stops the deploy with an error naming the transfer. Fund the sender via `wallets.json` (`usdc`, `mrd`) or an earlier transfer; nothing is minted silently. Every account starts with 10,000 ETH.

Owner: C (Parvati).
