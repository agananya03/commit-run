# ProofOfIntent API

Every endpoint across **rag** (B, :8000), **sim** (C, :4002) and **backend** (A, :4000), plus the contract calls the backend makes.
Types are named after [`schemas/types.ts`](schemas/types.ts); JSON Schemas are in [`schemas/json/`](schemas/json) (`meridian.schema.json` holds all of them).

## Conventions

- JSON in and out (`Content-Type: application/json`), camelCase fields.
- `Hex` is 0x-prefixed hex: selectors, slots, sha256 and keccak256 digests. Addresses are 0x-prefixed strings.
- uint256 values (wei, token amounts) are **decimal strings**. Timestamps are ISO 8601 UTC. Probabilities are numbers in [0, 1].
- "Not computed yet" is `null`, never a missing field.
- Objects are closed: unknown fields fail schema validation (`additionalProperties: false`).
- `Chunk.sha256` is the sha256 of `Chunk.text` (UTF-8). A `Citation` carries the same `sha256` and `sourceUri` as its chunk, and its `quote` is an exact substring of that chunk's text (B verifies this server-side; `npm test` in `/shared` checks the mocks).
- Chunk ids are `<proposalId>:<type>:<n>`. Source URIs look like `pdf://MIP-21/proposal.pdf#page=3`, `forum://MIP-21/forum_thread.json#post=1`, `social://MIP-21/social.json#msg=4`.
- The backend validates **every** rag/sim response with zod; a mismatch is a `502 UPSTREAM_INVALID`.
- Errors from all services use `ApiError`:
  ```json
  { "error": { "code": "NOT_FOUND", "message": "Proposal MIP-99 not found" } }
  ```
  Codes: `VALIDATION_FAILED` 400, `NOT_FOUND` 404, `CONFLICT` 409, `CHAIN_REVERT` 409, `UPSTREAM_UNAVAILABLE` 502, `UPSTREAM_INVALID` 502, `INTERNAL` 500.
- In the examples, `…` marks a value cut short for readability. The full payloads are in the mock files.

### Mocks

With `USE_MOCKS=true` (backend) or `NEXT_PUBLIC_USE_MOCKS=true` (frontend), clients read `/shared/mocks` instead of calling the service:

| File | Stands in for | Type |
|---|---|---|
| `ingest.MIP-21.json` | rag `POST /ingest` | `Chunk[]` |
| `summarize.MIP-21.json` | rag `POST /summarize` | `DecisionSummary` |
| `extract-intent.MIP-21.json` | rag `POST /extract-intent` | `IntentSpec` |
| `simulate.MIP-21.json` | sim `POST /simulate` | `SimulationResult` |
| `deployments.json` | sim `GET /deployments` and `/contracts/deployments/localhost.json` | `Deployments` |

`deployments.json` is a copy of the real `/contracts/deployments/localhost.json` written by `npm run deploy:seed` (full ABIs). Hardhat account #0 deploys MeridianToken, MockUSDC, GuardedTimelock (which creates GovernanceGuard itself), MeridianGovernor, Treasury, VaultV1 + VaultProxy, ProposalRegistry; the MIP-21 proposer (#13) deploys VaultV2. The MIP-21 mocks use these addresses, and `bytecodeHash` is the real VaultV2 runtime code hash read from the deployed chain.

---

## rag: FastAPI on :8000 (B)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `Health` |
| POST | `/ingest` | `IngestRequest` | `Chunk[]` |
| POST | `/search` | `SearchRequest` | `Chunk[]` (best first) |
| POST | `/summarize` | `SummarizeRequest` | `DecisionSummary` |
| POST | `/extract-intent` | `ExtractIntentRequest` | `IntentSpec` |
| POST | `/explain` | `ExplainRequest` | `Explanation` |
| GET | `/chunks/:id` | | `Chunk` |

### `POST /ingest` → `Chunk[]`

```json
{
  "proposalId": "MIP-21",
  "files": [
    { "type": "forum", "path": "data/scenarios/MIP-21/forum_thread.json" },
    { "type": "pdf", "path": "data/scenarios/MIP-21/proposal.pdf" },
    { "type": "social", "path": "data/scenarios/MIP-21/social.json" },
    { "type": "onchain", "path": "data/scenarios/MIP-21/onchain_actions.json" }
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
    "sourceUri": "forum://MIP-21/forum_thread.json#post=1",
    "text": "This is purely a gas optimisation, with no change to ownership. Storage layout is preserved and the Timelock stays in control of the Vault.",
    "sha256": "0xa36488be4755e2b1b986497b27fbf4fe7f7687c1a8192a820fdcd03c47e9fc8d"
  },
  {
    "id": "MIP-21:pdf:0",
    "proposalId": "MIP-21",
    "sourceType": "pdf",
    "sourceUri": "pdf://MIP-21/proposal.pdf#page=3",
    "page": 3,
    "text": "3. Scope. The upgrade replaces the Vault implementation behind the existing UUPS proxy at 0x0165…Eb8F. …The Timelock remains the sole owner of the Vault.",
    "sha256": "0xa72aa6f8dbdbc090d4ce0e95eda2a13b8460cb2242d3a3406198306e7cef8885"
  }
]
```

### `POST /search` → `Chunk[]`

Hybrid ranking (0.7 × cosine + 0.3 × BM25), always filtered to `proposalId`. `k` defaults to 8.
```json
{ "proposalId": "MIP-17", "query": "how much money is requested", "k": 8 }
```

### `POST /summarize` → `DecisionSummary`

Body: `{ "proposalId": "MIP-21" }`. Requires a prior `/ingest`. Full response: [`mocks/summarize.MIP-21.json`](mocks/summarize.MIP-21.json).
```json
{
  "proposalId": "MIP-21",
  "tldr": "Upgrades the Vault to VaultV2, which the author says packs storage to make deposits and withdrawals ~1% cheaper, with no change to ownership.",
  "treasuryImpact": { "amountUsd": null, "pctOfTreasury": null, "recipients": [], "citations": [] },
  "dependencies": [{ "text": "Relies on an internal core-team review; no external audit or published diff.", "citations": [{ "chunkId": "MIP-21:forum:2", "sha256": "0x9540…69c2", "quote": "the implementation was reviewed internally by the core team", "sourceUri": "forum://MIP-21/forum_thread.json#post=6" }] }],
  "risks": [{ "text": "The proposer publicly thanks an unexplained wallet for running the benchmarks.", "citations": [{ "chunkId": "MIP-21:social:0", "sha256": "0xcd6e…2e21", "quote": "Big thanks to 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097 for running the benchmarks.", "sourceUri": "social://MIP-21/social.json#msg=4" }] }],
  "claims": [
    {
      "id": "cl2", "kind": "technical",
      "text": "No change to ownership: the Timelock remains sole owner of the Vault.",
      "citations": [{ "chunkId": "MIP-21:forum:1", "sha256": "0xa36488be4755e2b1b986497b27fbf4fe7f7687c1a8192a820fdcd03c47e9fc8d", "quote": "with no change to ownership", "sourceUri": "forum://MIP-21/forum_thread.json#post=1" }],
      "support": "supported", "pSupported": 0.74
    }
  ]
}
```
`support` reflects the documents only. Execution evidence enters later, through the backend's findings.

### `POST /extract-intent` → `IntentSpec`

Body: `{ "proposalId": "MIP-21" }`. Uses forum, PDF and social chunks only, **never** calldata. Full response: [`mocks/extract-intent.MIP-21.json`](mocks/extract-intent.MIP-21.json).
```json
{
  "proposalId": "MIP-21",
  "summary": "Gas optimisation of the Vault via a VaultV2 implementation upgrade; no change to ownership.",
  "actions": [
    {
      "kind": "upgrade",
      "target": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
      "description": "Upgrade the Vault to VaultV2 (storage packing / gas optimisation only).",
      "citations": [{ "chunkId": "MIP-21:forum:0", "sha256": "0x3ace…0ebe", "quote": "VaultV2 packs reserveCap and lastRebalance into one slot", "sourceUri": "forum://MIP-21/forum_thread.json#post=1" }]
    }
  ],
  "explicitlyExcluded": ["change to ownership"],
  "confidence": 0.91
}
```
The text never mentions the `treasury.approve` call, so it is not an intent action. That gap is what the verdict engine catches.

### `POST /explain` → `Explanation`

```json
{ "proposalId": "MIP-21", "findings": [ { "id": "f1", "severity": "critical", "category": "ownership_change", "…": "…" } ] }
```
```json
{
  "headline": "MIP-21 does more than it says",
  "paragraph": "The proposal promised a gas optimisation with no change to ownership. The submitted code also makes wallet 0xdF3e…7097 the vault owner and approves it to spend all treasury USDC.",
  "perFinding": [
    { "findingId": "f1", "sentence": "Ownership of the Vault moves from the Timelock to 0xdF3e…7097." },
    { "findingId": "f2", "sentence": "The Treasury approves 0xdF3e…7097 to spend unlimited USDC." }
  ]
}
```
At most 120 words, written for a non-technical token holder, built only from facts in the findings, keeping each finding's id.

### `GET /chunks/:id` → `Chunk`

`GET /chunks/MIP-21:pdf:0` returns the single chunk; `404` if unknown.

---

## sim: Express on :4002 (C)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `Health` |
| POST | `/simulate` | `SimulateRequest` | `SimulationResult` |
| GET | `/deployments` | | `Deployments` |
| POST | `/reset` | | `Deployments` (of the fresh chain) |

### `POST /simulate` → `SimulationResult`

Snapshots the Anvil fork (:8546), impersonates the timelock, sends each call, records before/after state, then reverts the snapshot.
```json
{
  "proposalId": "MIP-21",
  "targets": ["0x0165878A594ca255338adfa4d48449f69242Eb8F", "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"],
  "values": ["0", "0"],
  "calldatas": [
    "0x4f1ef28600000000000000000000000017f24d3b8bc1150553b54da30b4d993acb88921200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024be6b99e3000000000000000000000000df3e18d64bc6a983f673ab319ccae4f1a57c709700000000000000000000000000000000000000000000000000000000",
    "0xe1f21c67000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f0512000000000000000000000000df3e18d64bc6a983f673ab319ccae4f1a57c7097ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  ]
}
```
Response (full: [`mocks/simulate.MIP-21.json`](mocks/simulate.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "success": true,
  "decodedCalls": [
    { "target": "0x0165…Eb8F", "contractName": "Vault (ERC1967Proxy)", "selector": "0x4f1ef286", "signature": "upgradeToAndCall(address,bytes)", "args": ["0x17F24D3b8Bc1150553b54Da30B4d993AcB889212", "0xbe6b99e3…"] },
    { "target": "0x0165…Eb8F", "contractName": "VaultV2 (delegatecall)", "selector": "0xbe6b99e3", "signature": "reinitializeV2(address)", "args": ["0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097"] },
    { "target": "0xDc64…F6C9", "contractName": "Treasury", "selector": "0xe1f21c67", "signature": "approve(address,address,uint256)", "args": ["0xe7f1…0512", "0xdF3e…7097", "115792089237316195423570985008687907853269984665640564039457584007913129639935"] },
    { "target": "0xe7f1…0512", "contractName": "MockUSDC", "selector": "0x095ea7b3", "signature": "approve(address,uint256)", "args": ["0xdF3e…7097", "115792089237316195423570985008687907853269984665640564039457584007913129639935"] }
  ],
  "tokenTransfers": [],
  "approvals": [{ "token": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "owner": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9", "spender": "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097", "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935" }],
  "ownershipChanges": [{ "contract": "0x0165878A594ca255338adfa4d48449f69242Eb8F", "role": "owner", "before": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", "after": "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097" }],
  "implementationChanges": [{
    "proxy": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    "before": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    "after": "0x17F24D3b8Bc1150553b54Da30B4d993AcB889212",
    "addedSelectors": [{ "selector": "0x0db4818a", "signature": "migrateReserves(address)" }, { "selector": "0xbe6b99e3", "signature": "reinitializeV2(address)" }],
    "removedSelectors": []
  }],
  "storageDiffs": [{ "contract": "0x0165…Eb8F", "slot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "before": "0x…5fc8d326…75707", "after": "0x…17f24d3b…89212" }],
  "events": [{ "contract": "0x0165…Eb8F", "name": "OwnershipTransferred", "args": { "previousOwner": "0x9fE4…a6e0", "newOwner": "0xdF3e…7097" } }],
  "bytecodeHash": "0x92ff4c77b74114ec60e6d388b53712b4e125417d7277a5b98ea6036c4a4d05d9",
  "simHash": "0x077c2655f0bbb291f1fbc5af2e71f06e2da54ed28d65f044825bcef8190de7be"
}
```
- `decodedCalls` includes nested and internal calls (the `reinitializeV2` inside `upgradeToAndCall`, and the USDC `approve` made by the Treasury).
- Facts only: the sim never judges intent, and detection does not depend on function names.
- `bytecodeHash` is the keccak256 of the new implementation's runtime bytecode. `simHash` is the keccak256 of the canonical JSON result. Arrays are sorted and the fork block is pinned, so the same input always gives the same `simHash`.
- A revert still returns `200` with `success: false` and the decoded `revertReason`.

### `GET /deployments` → `Deployments`

```json
{
  "chainId": 31337,
  "deployBlock": 1,
  "contracts": {
    "MockUSDC": { "address": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "decimals": 6, "abi": ["…"] },
    "VaultProxy": { "address": "0x0165878A594ca255338adfa4d48449f69242Eb8F", "abi": ["…"] }
  }
}
```
Full: [`mocks/deployments.json`](mocks/deployments.json). `decimals` appears only on token contracts (B uses it to convert intent amounts to base units).

---

## backend: Express on :4000 (A)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `Health` (deps: postgres, redis, rpc, rag, sim) |
| GET | `/docs` · `/docs.json` | | Swagger UI · OpenAPI JSON |
| GET | `/queues` | | bull-board UI (pipeline jobs, results, errors, retries) |
| POST | `/proposals` | `CreateProposalRequest` or multipart files | `201 ProposalBundle` |
| GET | `/proposals` | | `Proposal[]` |
| GET | `/proposals/:id` | | `ProposalBundle` |
| POST | `/proposals/:id/versions` | multipart files | `201 ProposalVersion` |
| POST | `/proposals/:id/commit` | | `CommitResult` |
| POST | `/proposals/:id/run` | | `202 RunResult` |
| POST | `/proposals/:id/disclosure` | `DisclosureRequest` | `201 CoiReport` |
| POST | `/proposals/:id/reverify` | | `ReverifyResult` |
| GET | `/proposals/:id/assessment?simHash=` | | `text/markdown` technical assessment (header `X-Report-Hash`) |

`:id` accepts the slug (`MIP-21`) or the database id.

### `GET /proposals` → `Proposal[]`

```json
[
  {
    "id": "clx21…",
    "slug": "MIP-21",
    "title": "VaultV2: storage packing and gas optimisation",
    "proposer": "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
    "status": "HALTED",
    "governorProposalId": "95770418730186424211874856728532228392459849764019463351709297748745394921355",
    "operationId": "0xf3319604e909c2fa4553509a60825ba9098e0cc16d8197e79193cd5e40d06620",
    "createdAt": "2026-10-25T09:11:58Z",
    "updatedAt": "2026-10-25T09:14:02Z"
  }
]
```
`status` values: `DRAFT → INGESTED → COMMITTED → ACTIVE → QUEUED → EXECUTED`, or `DEFEATED`, or `HALTED` (flagged by the watchdog).

### `GET /proposals/:id` → `ProposalBundle`

```json
{
  "proposal": { "slug": "MIP-21", "status": "HALTED", "…": "…" },
  "versions": [
    {
      "proposalId": "clx21…",
      "version": 1,
      "canonicalJson": { "title": "…", "proposer": "0x1CBd…C9Ec", "actions": ["…"], "files": ["…"], "prevHash": "0x0000…0000" },
      "versionHash": "0x4c1d…e2a7",
      "prevHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "evidenceRoot": "0x91b0…5f3c",
      "commitTxHash": "0x2f6a…88d1",
      "files": [{ "type": "pdf", "uri": "pdf://MIP-21/proposal.pdf", "sha256": "0x…", "bytes": 48213, "proof": ["0x…", "0x…"] }],
      "createdAt": "2026-10-25T09:12:05Z"
    }
  ],
  "summary": { "…": "DecisionSummary" },
  "intent": { "…": "IntentSpec" },
  "simulation": { "…": "SimulationResult" },
  "coi": { "…": "CoiReport" },
  "findings": [{ "…": "Finding" }],
  "explanation": { "…": "Explanation" },
  "risk": { "…": "RiskChain" },
  "chainEvents": [{ "…": "ChainEvent" }],
  "flag": { "…": "WatchdogFlag" }
}
```
Stages that have not run are `null` (or `[]` for lists).

**Hash chain:** `versionHash = keccak256(RFC 8785 canonical JSON of canonicalJson)`. `canonicalJson` includes `prevHash` (all zeros for version 1). `evidenceRoot` is the root of an OpenZeppelin `StandardMerkleTree` over `[type, sha256]` leaves, and each file carries its own `proof`.

### `POST /proposals` → `ProposalBundle` (201)

Send `{ "slug": "MIP-21" }` to load `data/scenarios/MIP-21/`, or a multipart upload of the files.

### `POST /proposals/:id/commit` → `CommitResult`

Calls `ProposalRegistry.commit(registryId, versionHash, prevHash, evidenceRoot, uri)` for **every** uncommitted version, oldest first, and stores each `commitTxHash`. The registry only accepts a `prevHash` equal to its latest, so skipping one would revert. Returns the last commit.
- `registryId` is the slug's number (`MIP-21` → `21`); `uri` is `poi://<slug>/v<n>`.
- If a version is already on-chain but the backend missed the receipt, its tx is recovered from the `ProposalCommitted` log.
- A successful commit moves the proposal from `DRAFT`/`INGESTED` to `COMMITTED`.
```json
{ "proposalId": "clx21…", "version": 1, "versionHash": "0x4540…6cf1", "txHash": "0x2144…3bd3", "blockNumber": 3135 }
```
Errors: `409 CHAIN_REVERT` if the registry's latest hash isn't this version's `prevHash` (stale chain, e.g. after a chain reset), or if another address owns that registry id; `409 CONFLICT` if nothing is pending; `502 UPSTREAM_UNAVAILABLE` if the RPC is down or no registry is deployed.

### `POST /proposals/:id/run` → `RunResult` (202)

Runs the BullMQ pipeline on the latest version: `ingest`, then `summarize` + `extractIntent` in parallel, then `commit → coi → simulate → verdict → risk`.
- Each step retries twice with exponential backoff; a step that finally fails stops the pipeline.
- Steps are idempotent per (version, step): stored outputs are reused, and a version is never committed twice.
- `simulate` encodes the version's `onchain_actions.json` into real calldata with the deployed ABIs.
- `coi`, `verdict` and `risk` are placeholders until H9/H11/H13 (they complete without storing anything).
- Progress streams over `pipeline:progress`; jobs can be inspected in the bull-board UI at `GET /queues`.
```json
{ "proposalId": "clx21…", "flowId": "pipeline:<versionId>" }
```
`409 CONFLICT` if this version already ran (or is running); `POST …/run?force=true` re-runs it.

### `POST /proposals/:id/disclosure` → `CoiReport` (201)

```json
{
  "proposer": "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  "wallets": ["0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec"],
  "statement": "These are all wallets I control.",
  "signature": "0x5d1e…1b"
}
```
- The signed message is the RFC 8785 canonical JSON string of `{ proposalSlug, wallets (sorted), statement }`.
- It is checked with `ethers.verifyMessage` (EIP-191), and the recovered signer must equal `proposer`. Otherwise the backend returns `400 VALIDATION_FAILED`.
- The disclosure is stored as a `disclosure` evidence file, which creates a new version.

Response (MIP-21, where the alt wallet is not disclosed):
```json
{
  "proposalId": "MIP-21",
  "proposer": "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  "disclosed": ["0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec"],
  "signatureValid": true,
  "undisclosedLinks": [
    {
      "from": "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
      "to": "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097",
      "path": ["0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec", "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097"],
      "hops": 1,
      "pLink": 0.92,
      "reasons": ["Proposer was the first funder of 0xdF3e…7097", "Funded within 30 days before the proposal", "Not in the signed disclosure", "Becomes Vault owner and unlimited USDC spender in simulation"]
    }
  ],
  "pCoi": 0.92
}
```
`pLink = sigmoid(2.0·pathExists + 1.5·firstFunderOnPath + 1.0·recentFunding + 1.0·undisclosed + 1.2·sharedFunder − 3.0 − 1.5·throughHub)`; `pCoi = 1 − ∏(1 − pLink)` over the top 5 links.

### `POST /proposals/:id/reverify` → `ReverifyResult`

Rebuilds every version's canonical JSON and evidence root from the stored files, compares them with `ProposalRegistry`, re-runs the simulation on the pinned fork block, and compares `simHash` and the findings hash with the `Flagged` event.
```json
{
  "allMatch": true,
  "versions": [{ "version": 1, "versionHash": "0x4c1d…e2a7", "onchainVersionHash": "0x4c1d…e2a7", "evidenceRootMatch": true, "match": true }],
  "simMatch": true,
  "findingsMatch": true
}
```

### `GET /proposals/:id/assessment?simHash=0x…` → `text/markdown`

The technical assessment of one simulation run (the latest when `simHash` is omitted): every call, state change and said-vs-does finding, Seatbelt-style. It is deterministic, and its sha256 (also in the `X-Report-Hash` header) is what the backend attests in `ProposalRegistry.attest` after the verdict step, and again for the exact queued payload after the watchdog's decision. Anyone can fetch it and re-hash it against the `AssessmentAttested` event in the bundle's `chainEvents`.

### Findings and risk (inside the bundle)

`findings` for MIP-21:
```json
[
  { "id": "f1", "severity": "critical", "category": "ownership_change", "said": "No change to ownership", "does": "Vault owner changes from GuardedTimelock to 0xdF3e…7097", "evidence": [{ "chunkId": "MIP-21:forum:1", "sha256": "0xa364…fc8d", "quote": "with no change to ownership", "sourceUri": "forum://MIP-21/forum_thread.json#post=1" }], "simRef": "ownershipChanges[0]" },
  { "id": "f2", "severity": "critical", "category": "unlimited_approval", "said": "Not mentioned", "does": "Treasury approves 0xdF3e…7097 for unlimited USDC", "evidence": [], "simRef": "approvals[0]" },
  { "id": "f3", "severity": "high", "category": "new_privileged_function", "said": "Storage packing / gas optimisation only", "does": "VaultV2 adds migrateReserves(address) and reinitializeV2(address)", "evidence": [{ "chunkId": "MIP-21:forum:0", "sha256": "0x3ace…0ebe", "quote": "VaultV2 packs reserveCap and lastRebalance into one slot", "sourceUri": "forum://MIP-21/forum_thread.json#post=1" }], "simRef": "implementationChanges[0].addedSelectors" },
  { "id": "f4", "severity": "high", "category": "undeclared_action", "said": "Only the Vault upgrade is described", "does": "Second call Treasury.approve(USDC, 0xdF3e…7097, max) is not covered by any intent action", "evidence": [], "simRef": "decodedCalls[2]" }
]
```

`risk`: log-odds update, `logit(post) = logit(prior) + Σ ln LR_s`, with prior 0.05. Each stage's `probability` is the running posterior.
```json
{
  "proposalId": "MIP-21",
  "prior": 0.05,
  "stages": [
    { "stage": "claims", "probability": 0.1364, "likelihoodRatio": 3, "explanation": "40% of claims unsupported", "findingIds": [] },
    { "stage": "coi", "probability": 0.5581, "likelihoodRatio": 8, "explanation": "Undisclosed proposer → beneficiary link, pCoi 0.92", "findingIds": [] },
    { "stage": "voting", "probability": 0.6545, "likelihoodRatio": 1.5, "explanation": "61% of voting power from 4 wallets (Nakamoto ≤ 4)", "findingIds": [] },
    { "stage": "execution", "probability": 0.9743, "likelihoodRatio": 20, "explanation": "Critical execution discrepancies", "findingIds": ["f1", "f2", "f3", "f4"] }
  ],
  "posterior": 0.9743,
  "level": "CRITICAL",
  "action": "halt"
}
```
Levels: `< 0.1` LOW, `< 0.4` MEDIUM, `< 0.8` HIGH, else CRITICAL. The action is `halt` if the level is CRITICAL or there is any critical execution finding, `review` if HIGH, otherwise `none`.

---

## backend Socket.IO (same origin as :4000)

Event payloads are typed by `SocketEvents`. In events, `proposalId` is the **slug** (`MIP-21`).

**Subscribe to receive events.** After connecting, emit `subscribe` with a slug, or `"*"` for every proposal (a dashboard list). Use `unsubscribe` with the same body to leave.

```ts
const socket = io("http://localhost:4000");
socket.emit("subscribe", { proposalId: "MIP-21" }); // or { proposalId: "*" }
socket.on("pipeline:progress", (p) => console.log(p.step, p.status));
```

Each event goes to room `proposal:<slug>` and to `proposal:*`. A `chain:event` with `proposalId: null` (e.g. a token transfer) goes to `proposal:*` only.

| Event | Payload | When |
|---|---|---|
| `pipeline:progress` | `PipelineProgress` | each pipeline step starts, completes or fails |
| `chain:event` | `ChainEvent` | a Governor / GuardedTimelock / GovernanceGuard / ProposalRegistry log is stored |
| `watchdog:flag` | `WatchdogFlag` | `GovernanceGuard.flag()` is mined |

```json
{ "proposalId": "MIP-21", "step": "simulate", "status": "completed", "ms": 2140 }
```
```json
{ "proposalId": "MIP-21", "contract": "GovernanceGuard", "name": "Flagged", "args": { "operationId": "0xf331…6620", "findingsHash": "0x1f0c…aa92", "watchdog": "0x7099…79C8" }, "blockNumber": 57, "txHash": "0x9be1…74aa", "logIndex": 0 }
```
```json
{
  "proposalId": "MIP-21",
  "operationId": "0xf3319604e909c2fa4553509a60825ba9098e0cc16d8197e79193cd5e40d06620",
  "findingsHash": "0x1f0c…aa92",
  "findings": [{ "id": "f1", "…": "…" }],
  "risk": { "posterior": 0.9743, "level": "CRITICAL", "action": "halt", "…": "…" },
  "txHash": "0x9be1…74aa",
  "blockNumber": 57,
  "flaggedAt": "2026-10-25T09:14:02Z"
}
```
`findingsHash = keccak256(canonical JSON of findings)`. The watchdog recomputes findings from the **queued** payloads (from `CallScheduled`), not from the forum version.

---

## Contract calls (C → used by A)

| Contract | Call | Who |
|---|---|---|
| ProposalRegistry | `commit(uint256 proposalId, bytes32 versionHash, bytes32 prevHash, bytes32 evidenceRoot, string uri)`, which emits `ProposalCommitted` and reverts if `prevHash` isn't the latest | backend (PROPOSER key) |
| ProposalRegistry | `attest(uint256 proposalId, bytes32 reportHash, bytes32 simHash, string uri)`, which emits `AssessmentAttested(proposalId, index, reportHash, simHash, uri, attester)`; the proposal must have a committed version | backend (PROPOSER key), after the verdict step and after the watchdog decision |
| MeridianGovernor | `proposeWithEvidence(targets, values, calldatas, description, bytes32 evidenceRoot, address[] disclosedWallets, string disclosureUri)`, which emits `ProposalCreated` (description = `description + "

evidence: " + evidenceRoot`) and `EvidenceBound(proposalId, proposer, evidenceRoot, disclosedWallets, disclosureUri)`. Plain `propose` reverts `EvidenceRequired()` | proposers (`npm run gov -- propose`) |
| GovernanceGuard | `flag(bytes32 operationId, bytes32 findingsHash)`, which emits `Flagged`; only `WATCHDOG_ROLE` | backend watchdog (Hardhat #1) |
| GovernanceGuard | `clear(bytes32 operationId)`, which emits `Cleared`; only the timelock (i.e. a passed override vote) | governance |
| GuardedTimelock | `execute` / `executeBatch` revert `GuardFlagged` while `guard.isFlagged(id)` | anyone |

`operationId = hashOperationBatch(targets, values, calldatas, 0x0, salt)`, where `salt = bytes20(governor) ^ descriptionHash` (OpenZeppelin `GovernorTimelockControl`). `descriptionHash` is the keccak256 of the bound description (with the `evidence:` line), which `MeridianGovernor.boundDescription(description, evidenceRoot)` returns.

`evidenceRoot` is the same Merkle root the backend commits: leaves `[fileType, sha256]` of the scenario's evidence files, OpenZeppelin `StandardMerkleTree` (`contracts/scripts/lib/evidence.ts` = `backend/src/integrity/merkle.ts`).

## Demo addresses (default Hardhat mnemonic)

| Name | Address |
|---|---|
| Deployer (#0) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Watchdog (#1) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| MIP-21 proposer (#13) | `0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec` |
| MIP-21 alt wallet (#14) | `0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097` |
| MeridianToken | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| MockUSDC | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| GuardedTimelock | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| GovernanceGuard (created by GuardedTimelock) | `0x75537828f2ce51be7289709686A69CbFDbB714F1` |
| MeridianGovernor | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| Treasury | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| VaultV1 (impl) | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| Vault (proxy) | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| ProposalRegistry | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| VaultV2 (impl, MIP-21, deployed by #13) | `0x17F24D3b8Bc1150553b54Da30B4d993AcB889212` |

Contract addresses depend on deploy order. If the deploy script changes the order, regenerate the mocks and this table from `deployments/localhost.json`.
