# ProofOfIntent API

Every endpoint across **rag** (:8000), **sim** (:4002) and **backend** (:4000).
Response types are named after [`schemas/types.ts`](schemas/types.ts); JSON Schemas live in [`schemas/json/`](schemas/json).

> **Untyped:** request bodies, and some backend responses, have no type in `types.ts` yet. They are marked *untyped* below and listed under [Gaps](#gaps-not-yet-in-typests). Treat their shapes as proposals until they are added to the contract.

## Conventions

- JSON in and out (`Content-Type: application/json`).
- `Hex` values are 0x-prefixed lowercase hex: selectors, storage slots, sha256 digests, bytecode hashes.
- Token amounts in `SimulationResult` are uint256 **decimal strings**.
- Probabilities (`pSupported`, `pLink`, `pCoi`, `probability`, `prior`, `posterior`, `confidence`) are numbers in [0, 1].
- Objects are closed: unknown fields fail schema validation (`additionalProperties: false`).
- `Chunk.sha256` is the sha256 of `Chunk.text` (UTF-8). A `Citation` must carry the same `sha256` and `sourceUri` as its chunk, and `quote` must appear verbatim in that chunk's text. `npm test` in `/shared` enforces this on the mocks.
- The backend validates **every** rag/sim response with zod and rejects anything that doesn't match (`502`).
- **Mocks:** with `USE_MOCKS=true`, backend clients read `shared/mocks/<endpoint>.<proposalId>.json` instead of calling rag/sim:

  | Mock | Endpoint | Type |
  |---|---|---|
  | `ingest.MIP-21.json` | rag `POST /ingest` | `Chunk[]` |
  | `summarize.MIP-21.json` | rag `POST /summarize` | `DecisionSummary` |
  | `extract-intent.MIP-21.json` | rag `POST /extract-intent` | `IntentSpec` |
  | `simulate.MIP-21.json` | sim `POST /simulate` | `SimulationResult` |

- Errors (*untyped*), proposed for all three services:
  ```json
  { "error": { "code": "NOT_FOUND", "message": "Proposal MIP-99 not found" } }
  ```
- In the examples, `…` marks a value cut short for readability. The full payloads are in the mock files.

---

## rag: FastAPI on :8000

### `GET /health`

*Untyped.* `200 { "status": "ok" }`

### `POST /ingest` → `Chunk[]`

Parses forum JSON, PDFs, social posts and on-chain proposal data, splits them into chunks, embeds them into pgvector and returns every chunk.

Request (*untyped*):
```json
{
  "proposalId": "MIP-21",
  "sources": [
    { "sourceType": "forum", "uri": "data/MIP-21/forum.json" },
    { "sourceType": "pdf", "uri": "data/MIP-21/MIP-21-technical-spec.pdf" },
    { "sourceType": "social", "uri": "data/MIP-21/social.json" },
    { "sourceType": "onchain", "uri": "data/MIP-21/calldata.json" }
  ]
}
```

Response (full: [`mocks/ingest.MIP-21.json`](mocks/ingest.MIP-21.json), 7 chunks):
```json
[
  {
    "id": "MIP-21:forum:1",
    "proposalId": "MIP-21",
    "sourceType": "forum",
    "sourceUri": "data/MIP-21/forum.json",
    "text": "This is purely a gas optimisation, with no change to ownership. The Timelock stays in control of the Reserve.",
    "sha256": "0x4cb88b32f56cbb14f4d1e54aff6cb22bb4480f97c98e52344d865dba4f6c654b"
  },
  {
    "id": "MIP-21:pdf:0",
    "proposalId": "MIP-21",
    "sourceType": "pdf",
    "sourceUri": "data/MIP-21/MIP-21-technical-spec.pdf",
    "page": 3,
    "text": "3. Scope. The upgrade replaces the MeridianReserve implementation behind the existing UUPS proxy at 0x5FC8…5707. Storage layout is preserved. The Timelock remains the sole owner of the Reserve.",
    "sha256": "0x47c2d4ef19fc40dea80df0407b0b202525c23819d470dcc126ad65876541d1c8"
  }
]
```

### `POST /summarize` → `DecisionSummary`

Request (*untyped*): `{ "proposalId": "MIP-21" }`. Needs a prior `/ingest`.

Response (full: [`mocks/summarize.MIP-21.json`](mocks/summarize.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "tldr": "Upgrades MeridianReserve to a new implementation that the author says makes deposits and withdrawals ~1% cheaper, with no change to ownership.",
  "treasuryImpact": { "amountUsd": null, "pctOfTreasury": null, "recipients": [], "citations": [] },
  "dependencies": [
    { "text": "Relies on an internal review only; the external audit happens after deployment.",
      "citations": [{ "chunkId": "MIP-21:forum:2", "sha256": "0x1cbe…ec46", "quote": "An external audit is planned after deployment.", "sourceUri": "data/MIP-21/forum.json" }] }
  ],
  "risks": [
    { "text": "The proposer announced a new wallet while voting is open.",
      "citations": [{ "chunkId": "MIP-21:social:0", "sha256": "0xd237…a0d9", "quote": "Also moving my ops to a fresh wallet 0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "sourceUri": "data/MIP-21/social.json" }] }
  ],
  "claims": [
    {
      "id": "cl2",
      "text": "No change to ownership: the Timelock remains sole owner of the Reserve.",
      "kind": "technical",
      "citations": [
        { "chunkId": "MIP-21:forum:1", "sha256": "0x4cb88b32f56cbb14f4d1e54aff6cb22bb4480f97c98e52344d865dba4f6c654b", "quote": "with no change to ownership", "sourceUri": "data/MIP-21/forum.json" }
      ],
      "support": "supported",
      "pSupported": 0.74
    }
  ]
}
```
`treasuryImpact.amountUsd` / `pctOfTreasury` are `null` when the text does not state them.
`support` reflects the documents only. Execution evidence is applied later, in the backend's findings.

### `POST /extract-intent` → `IntentSpec`

What the text says the proposal will do (`actions`) and what it says it will *not* do (`explicitlyExcluded`). The backend diffs this against `SimulationResult`.

Request (*untyped*): `{ "proposalId": "MIP-21" }`. Needs a prior `/ingest`.

Response (full: [`mocks/extract-intent.MIP-21.json`](mocks/extract-intent.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "summary": "Gas optimisation of MeridianReserve via an implementation upgrade; no change to ownership.",
  "actions": [
    {
      "kind": "upgrade",
      "target": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      "description": "Upgrade MeridianReserve to a gas-optimised implementation (gas optimisation only).",
      "citations": [{ "chunkId": "MIP-21:forum:0", "sha256": "0xa30f…33e6", "quote": "we upgrade MeridianReserve to a gas-optimised implementation", "sourceUri": "data/MIP-21/forum.json" }]
    }
  ],
  "explicitlyExcluded": ["change to ownership"],
  "confidence": 0.91
}
```
`IntentAction.kind` is one of `transfer | upgrade | param_change | approve | call`. Fill in only the optional fields the text actually states. Here the text never names the new implementation address, so `newImplementation` is absent.

---

## sim: simulation API on :4002

### `GET /health`

*Untyped.* `200 { "status": "ok" }`

### `POST /simulate` → `SimulationResult`

Forks the local Hardhat chain, impersonates the Timelock, executes the proposal's calls and reports what actually happened.

Request (*untyped*):
```json
{
  "proposalId": "MIP-21",
  "executor": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "targets": ["0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"],
  "values": ["0"],
  "calldatas": ["0x4f1ef286000000000000000000000000057ef64e23666f000b34ae31332854acbd1c85440000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002429b6eca90000000000000000000000009f2c188225babb8ac51c8b49c850678558fefb7b00000000000000000000000000000000000000000000000000000000"]
}
```

Response (full: [`mocks/simulate.MIP-21.json`](mocks/simulate.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "success": true,
  "decodedCalls": [
    { "target": "0x5FC8…5707", "contractName": "MeridianReserve", "selector": "0x4f1ef286", "signature": "upgradeToAndCall(address,bytes)", "args": ["0x057ef64E23666F000b34aE31332854aCBd1c8544", "0x29b6eca9…"] },
    { "target": "0x5FC8…5707", "contractName": "MeridianReserveV2 (delegatecall)", "selector": "0x29b6eca9", "signature": "initializeV2(address)", "args": ["0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B"] },
    { "target": "0x5FbD…0aa3", "contractName": "MockUSDC", "selector": "0x095ea7b3", "signature": "approve(address,uint256)", "args": ["0x9F2C…fb7B", "115792089237316195423570985008687907853269984665640564039457584007913129639935"] }
  ],
  "tokenTransfers": [],
  "approvals": [
    { "token": "0x5FbDB2315678afecb367f032d93F642f64180aa3", "owner": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "spender": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935" }
  ],
  "ownershipChanges": [
    { "contract": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "role": "owner", "before": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", "after": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B" }
  ],
  "implementationChanges": [
    {
      "proxy": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      "before": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
      "after": "0x057ef64E23666F000b34aE31332854aCBd1c8544",
      "addedSelectors": [
        { "selector": "0x0db4818a", "signature": "migrateReserves(address)" },
        { "selector": "0x29b6eca9", "signature": "initializeV2(address)" }
      ],
      "removedSelectors": []
    }
  ],
  "storageDiffs": [
    { "contract": "0x5FC8…5707", "slot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "before": "0x…dc64a140…f6c9", "after": "0x…057ef64e…8544" }
  ],
  "events": [
    { "contract": "0x5FC8…5707", "name": "OwnershipTransferred", "args": { "previousOwner": "0x9fE4…a6e0", "newOwner": "0x9F2C…fb7B" } }
  ],
  "bytecodeHash": "0xd86855a6290a1b2b062adf1bab46d8405480fe65bfddb253c591cafe18b226e1",
  "simHash": "0xc5ff091455de6b36c3d07e1c6a876a30a2f8940d74047d289f48e87b02639a83"
}
```
- `decodedCalls` includes internal calls (delegatecalls, the token `approve`), not just the top-level batch. That is how the hidden `initializeV2` and `approve` show up.
- `ownershipChanges.role` is `"owner"` for Ownable, or the role name (e.g. `"DEFAULT_ADMIN_ROLE"`) for AccessControl.
- `bytecodeHash` is the keccak256 of the new implementation's runtime bytecode. In the mock, `simHash` is keccak256 of the JSON of every other field. The real definition is still open (see Gaps).
- On a revert, return `200` with `success: false` and `revertReason`. A revert is evidence too.

---

## backend: Express on :4000

Swagger UI at `GET /docs`, OpenAPI JSON at `GET /docs.json`.

### Typed in `types.ts`

| Method | Path | Response | Notes |
|---|---|---|---|
| GET | `/proposals/:id/chunks` | `Chunk[]` | stored rag `/ingest` output |
| GET | `/proposals/:id/summary` | `DecisionSummary` | |
| GET | `/proposals/:id/intent` | `IntentSpec` | |
| GET | `/proposals/:id/simulation` | `SimulationResult` | |
| GET | `/proposals/:id/coi` | `CoiReport` | |
| GET | `/proposals/:id/findings` | `Finding[]` | said-vs-does diff |
| GET | `/proposals/:id/risk` | `RiskChain` | |

`404` when the proposal is unknown, or when that stage has not run yet.

#### `GET /proposals/:id/coi` → `CoiReport`

```json
{
  "proposalId": "MIP-21",
  "proposer": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "disclosed": [],
  "signatureValid": true,
  "undisclosedLinks": [
    {
      "from": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      "to": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B",
      "path": ["0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B"],
      "hops": 1,
      "pLink": 0.9,
      "reasons": [
        "0x9F2C…fb7B received its first ETH (1.0) from the proposer",
        "Proposer's social post calls 0x9F2C…fb7B their new wallet",
        "0x9F2C…fb7B becomes Reserve owner and unlimited USDC spender in simulation"
      ]
    }
  ],
  "pCoi": 0.88
}
```

#### `GET /proposals/:id/findings` → `Finding[]`

```json
[
  {
    "id": "f1",
    "severity": "critical",
    "category": "ownership_change",
    "said": "No change to ownership: the Timelock remains sole owner of the Reserve.",
    "does": "MeridianReserve owner changes from TimelockController (0x9fE4…a6e0) to 0x9F2C…fb7B.",
    "evidence": [
      { "chunkId": "MIP-21:forum:1", "sha256": "0x4cb88b32f56cbb14f4d1e54aff6cb22bb4480f97c98e52344d865dba4f6c654b", "quote": "with no change to ownership", "sourceUri": "data/MIP-21/forum.json" }
    ],
    "simRef": "ownershipChanges[0]"
  },
  {
    "id": "f2",
    "severity": "critical",
    "category": "unlimited_approval",
    "said": "Not mentioned.",
    "does": "MeridianReserve grants 0x9F2C…fb7B an unlimited USDC allowance.",
    "evidence": [],
    "simRef": "approvals[0]"
  },
  {
    "id": "f3",
    "severity": "high",
    "category": "new_privileged_function",
    "said": "Upgrade MeridianReserve to a gas-optimised implementation (gas optimisation only).",
    "does": "New implementation adds migrateReserves(address), letting the owner move all reserves.",
    "evidence": [
      { "chunkId": "MIP-21:forum:0", "sha256": "0xa30f48cc75931deb0b0ef67287a166109a41a38ba4d53643b7ce92525ca733e6", "quote": "we upgrade MeridianReserve to a gas-optimised implementation", "sourceUri": "data/MIP-21/forum.json" }
    ],
    "simRef": "implementationChanges[0].addedSelectors[0]"
  },
  {
    "id": "f4",
    "severity": "high",
    "category": "coi",
    "said": "No related wallets disclosed.",
    "does": "The sole beneficiary 0x9F2C…fb7B is the proposer's undisclosed alt wallet (1 hop, pLink 0.9).",
    "evidence": [
      { "chunkId": "MIP-21:social:0", "sha256": "0xd237f4c62b6b45aa2761c25bd4a07fa98c044276a8d57ea477e930000181a0d9", "quote": "Also moving my ops to a fresh wallet 0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "sourceUri": "data/MIP-21/social.json" }
    ]
  }
]
```
`simRef` is a path into the `SimulationResult` for the same proposal.

#### `GET /proposals/:id/risk` → `RiskChain`

Four chained Bayesian updates. Each stage's `probability` is the posterior after that stage: posterior odds = previous odds × `likelihoodRatio`.

```json
{
  "proposalId": "MIP-21",
  "prior": 0.05,
  "stages": [
    { "stage": "claims", "probability": 0.0594, "likelihoodRatio": 1.2, "explanation": "Upgrade justified only as gas optimisation; team review claim unsupported.", "findingIds": [] },
    { "stage": "coi", "probability": 0.3357, "likelihoodRatio": 8, "explanation": "Undisclosed 1-hop link from proposer to the beneficiary wallet.", "findingIds": ["f4"] },
    { "stage": "voting", "probability": 0.4311, "likelihoodRatio": 1.5, "explanation": "31% of For votes come from the proposer cluster.", "findingIds": [] },
    { "stage": "execution", "probability": 0.9681, "likelihoodRatio": 40, "explanation": "Execution contradicts 'no change to ownership' and adds an undisclosed unlimited approval and drain function.", "findingIds": ["f1", "f2", "f3"] }
  ],
  "posterior": 0.9681,
  "level": "CRITICAL",
  "action": "halt"
}
```
Proposed thresholds: `< 0.25` LOW, `< 0.5` MEDIUM, `< 0.8` HIGH, else CRITICAL. The action is `halt` (calls `GovernanceGuard.flag()`) when posterior ≥ 0.8 or any finding is `critical`, `review` from MEDIUM up, else `none`.

### Untyped (shapes proposed, not in `types.ts`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | service + dependency status (postgres, redis, rag, sim, rpc) |
| GET | `/proposals` | list proposals with status and risk level |
| GET | `/proposals/:id` | everything above in one call for the dashboard |
| POST | `/proposals/:id/analyze` | enqueue the BullMQ pipeline, returns `202 { jobId }` |
| GET | `/jobs/:jobId` | job status, current step, progress |
| GET | `/proposals/:id/evidence` | hash-chained evidence trail + on-chain commit info |
| POST | `/proposals/:id/flag` | manual `GovernanceGuard.flag(operationId, reasonHash)` |

Socket.IO (*untyped*): `analysis:progress`, `evidence:appended`, `analysis:completed`, `proposal:flagged`, in room `proposal:<id>`.

---

## Gaps (not yet in `types.ts`)

These are needed for the endpoints above but have no type in the contract yet. They should be agreed and added before teammates build against them:

1. **Request bodies** for `/ingest`, `/summarize`, `/extract-intent`, `/simulate`, `/analyze`, `/flag`.
2. **Evidence trail entry** (index, kind, payloadHash, prevHash, entryHash, on-chain commit tx), which is core to the pitch.
3. **Flag event** (operationId, reasonHash, txHash, guard address, auto vs manual).
4. **Proposal** record and list (id, title, proposer, operationId, governor state, analysis status).
5. **Job / progress** payloads for `/jobs/:id` and Socket.IO events.
6. **Voting** input to the `voting` risk stage (tally, voters, links to the proposer).
7. **Error** body and **health** response.
8. **Definitions:** whether `Hex` is 0x-prefixed (the mocks assume yes); what `simHash` is a hash of; `RiskChain.level` is upper-case while `Finding.severity` is lower-case.

---

## Demo addresses (local Hardhat, deterministic deploy order)

| Name | Address |
|---|---|
| MockUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| MeridianToken | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| TimelockController | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| MeridianGovernor | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| MeridianReserve V1 impl | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| MeridianReserve proxy | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| GovernanceGuard | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| EvidenceRegistry | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| MeridianReserve V2 impl (MIP-21, deployed by proposer) | `0x057ef64E23666F000b34aE31332854aCBd1c8544` |
| Proposer kestrel.eth (Hardhat #3) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Proposer alt wallet | `0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B` |
| Watchdog (Hardhat #1) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

These assume the contracts teammate deploys from Hardhat #0 in the order above. If the order changes, update this table and the mocks.
