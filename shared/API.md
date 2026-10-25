# ProofOfIntent API

Every endpoint across **rag** (:8000), **sim** (:4002) and **backend** (:4000).
Types are named after [`schemas/types.ts`](schemas/types.ts); JSON Schemas live in [`schemas/json/`](schemas/json).
Contract status: **draft v0**.

## Conventions

- JSON in and out (`Content-Type: application/json`), camelCase fields.
- uint256 values (wei, token amounts, vote weights) are **decimal strings**. Timestamps are ISO 8601 UTC.
- Addresses, hashes and selectors are 0x-prefixed hex. Patterns are enforced by the schemas.
- Objects are closed: unknown fields fail validation (`additionalProperties: false`).
- Errors from every service use `ApiError` with a 4xx/5xx status:
  ```json
  { "error": { "code": "NOT_FOUND", "message": "Proposal MIP-99 not found" } }
  ```
  Codes: `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `CONFLICT` (409), `UPSTREAM_UNAVAILABLE` (502), `UPSTREAM_INVALID` (502), `INTERNAL` (500).
- The backend validates **every** rag/sim response with zod. A response that does not match its schema is rejected with `UPSTREAM_INVALID`.
- **Mocks:** with `USE_MOCKS=true`, backend clients read `shared/mocks/<endpoint>.<proposalId>.json` instead of calling rag/sim, e.g. `simulate.MIP-21.json`. Every mock is checked against its schema by `npm test` in `/shared`.
- In the examples below, `…` marks a value cut short for readability. The full payloads are in the mock files.

---

## rag: FastAPI on :8000

### `GET /health` → `HealthResponse`

```json
{ "service": "rag", "status": "ok", "version": "0.1.0", "mocks": false, "deps": { "postgres": "ok", "llm": "ok" } }
```

### `POST /ingest`: `IngestRequest` → `IngestResponse`

Parses and chunks each source, embeds it into pgvector and returns per-document content hashes (the backend chains these into the evidence trail). If a `calldata` source is included, the parsed on-chain proposal is returned as `onchain`.

Request:
```json
{
  "proposalId": "MIP-21",
  "sources": [
    { "kind": "forum", "uri": "data/MIP-21/forum.json" },
    { "kind": "pdf", "uri": "data/MIP-21/MIP-21-technical-spec.pdf" },
    { "kind": "social", "uri": "data/MIP-21/social.json" },
    { "kind": "calldata", "uri": "data/MIP-21/calldata.json" }
  ]
}
```

Response (full: [`mocks/ingest.MIP-21.json`](mocks/ingest.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "documents": [
    {
      "id": "MIP-21:forum:0",
      "proposalId": "MIP-21",
      "kind": "forum",
      "uri": "data/MIP-21/forum.json",
      "title": "[MIP-21] MeridianReserve gas optimisation",
      "author": "kestrel.eth",
      "publishedAt": "2026-10-20T14:03:11Z",
      "contentHash": "0xb9dc02a4ea65633c3f431cf8b57381d90bc6ed4920ef0ce0bdd796a98da6ea0d",
      "chunkCount": 9,
      "excerpt": "TL;DR: we upgrade MeridianReserve to a gas-optimised implementation…"
    }
  ],
  "chunkCount": 26,
  "onchain": {
    "governorProposalId": "71240117917747628806640772231852050840836735106339123343864741404726318379014",
    "proposer": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "governor": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    "timelock": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "calls": [{ "target": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "value": "0", "data": "0x4f1ef286…" }],
    "descriptionHash": "0x1af95546fe3f7411660d911aa922f2158f9fe394c0513576d4ba842ccf17b9bf",
    "operationId": "0x1479f0221f839edab5b6bd6509e1d8de7cd01691d05237a1ce45da57ad021396"
  },
  "warnings": ["MIP-21:pdf:0 page 6 is an image-only diagram; no text extracted"],
  "ingestedAt": "2026-10-25T09:12:04Z"
}
```

Errors: `404 NOT_FOUND` if a `uri` does not exist; `400 VALIDATION_FAILED` for an unknown `kind`.

### `POST /summarize`: `SummarizeRequest` → `SummarizeResponse`

Requires a prior `/ingest` for the proposal (else `409 CONFLICT`).

Request:
```json
{ "proposalId": "MIP-21" }
```

Response (full: [`mocks/summarize.MIP-21.json`](mocks/summarize.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "title": "MIP-21: MeridianReserve gas optimisation",
  "summary": "MIP-21, proposed by kestrel.eth, upgrades the MeridianReserve contract…",
  "keyPoints": ["Upgrades MeridianReserve implementation via the UUPS proxy", "Claims no change to ownership: Timelock stays sole owner"],
  "citations": [
    { "documentId": "MIP-21:pdf:0", "chunkId": "MIP-21:pdf:0#4", "quote": "The Timelock remains the sole owner of the Reserve.", "page": 3 }
  ],
  "model": "mock"
}
```

### `POST /extract-intent`: `ExtractIntentRequest` → `ExtractIntentResponse`

Turns the text into checkable claims (what changes and what explicitly does *not* change), plus any wallet addresses mentioned, which feed the COI graph. Requires a prior `/ingest` (else `409 CONFLICT`).

Request:
```json
{ "proposalId": "MIP-21" }
```

Response (full: [`mocks/extract-intent.MIP-21.json`](mocks/extract-intent.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "claims": [
    {
      "id": "c1", "category": "gas", "expectation": "change",
      "statement": "Gas optimisation of MeridianReserve deposit/withdraw",
      "subject": "MeridianReserve implementation", "confidence": 0.96,
      "citations": [{ "documentId": "MIP-21:forum:0", "quote": "we upgrade MeridianReserve to a gas-optimised implementation…" }]
    },
    {
      "id": "c2", "category": "ownership", "expectation": "no_change",
      "statement": "No change to ownership",
      "subject": "MeridianReserve.owner", "confidence": 0.93,
      "citations": [{ "documentId": "MIP-21:pdf:0", "quote": "The Timelock remains the sole owner of the Reserve.", "page": 3 }]
    }
  ],
  "declaredTargets": ["MeridianReserve"],
  "walletMentions": [
    { "address": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "documentId": "MIP-21:social:0", "context": "Also moving my ops to a fresh wallet 0x9F2C…" }
  ],
  "model": "mock"
}
```

---

## sim: simulation API on :4002

### `GET /health` → `HealthResponse`

```json
{ "service": "sim", "status": "ok", "version": "0.1.0", "mocks": false, "deps": { "hardhat": "ok" } }
```

### `POST /simulate`: `SimulateRequest` → `SimulateResponse`

Forks the local Hardhat chain, impersonates `executor` (the Timelock), executes `calls` in order and diffs state: implementation slots, selectors, owners, roles, ERC-20 approvals and balances, and raw storage. It also re-runs the benchmark functions before and after the change to measure gas.

Request:
```json
{
  "proposalId": "MIP-21",
  "operationId": "0x1479f0221f839edab5b6bd6509e1d8de7cd01691d05237a1ce45da57ad021396",
  "executor": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "calls": [
    {
      "target": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      "value": "0",
      "data": "0x4f1ef286000000000000000000000000057ef64e23666f000b34ae31332854acbd1c85440000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002429b6eca90000000000000000000000009f2c188225babb8ac51c8b49c850678558fefb7b00000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

Response (full: [`mocks/simulate.MIP-21.json`](mocks/simulate.MIP-21.json)):
```json
{
  "proposalId": "MIP-21",
  "operationId": "0x1479f0221f839edab5b6bd6509e1d8de7cd01691d05237a1ce45da57ad021396",
  "forkBlock": 42,
  "success": true,
  "gasUsed": 187342,
  "decodedCalls": [
    {
      "index": 0,
      "target": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      "targetLabel": "MeridianReserve (proxy)",
      "value": "0",
      "selector": "0x4f1ef286",
      "signature": "upgradeToAndCall(address,bytes)",
      "args": [
        { "name": "newImplementation", "type": "address", "value": "0x057ef64E23666F000b34aE31332854aCBd1c8544" },
        { "name": "data", "type": "bytes", "value": "0x29b6eca9…" }
      ],
      "innerCalls": [
        { "index": 0, "target": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "value": "0", "selector": "0x29b6eca9", "signature": "initializeV2(address)",
          "args": [{ "name": "operator", "type": "address", "value": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B" }] }
      ]
    }
  ],
  "changes": [
    { "kind": "implementation_changed", "contract": "0x5FC8…5707", "before": "0xDc64…F6C9", "after": "0x057e…8544", "newCodeHash": "0xd868…26e1", "sourceVerified": false, "severity": "medium", "description": "Implementation upgraded…" },
    { "kind": "selector_added", "contract": "0x5FC8…5707", "selector": "0x0db4818a", "signature": "migrateReserves(address)", "severity": "high", "description": "New external function migrateReserves(address)…" },
    { "kind": "owner_changed", "contract": "0x5FC8…5707", "before": "0x9fE4…a6e0", "after": "0x9F2C…fb7B", "severity": "critical", "description": "Owner changed from TimelockController to 0x9F2C…fb7B" },
    { "kind": "approval_changed", "contract": "0x5FbD…0aa3", "tokenSymbol": "USDC", "owner": "0x5FC8…5707", "spender": "0x9F2C…fb7B", "before": "0", "after": "115792089237316195423570985008687907853269984665640564039457584007913129639935", "unlimited": true, "severity": "critical", "description": "…unlimited USDC allowance" }
  ],
  "gasBenchmarks": [
    { "contract": "0x5FC8…5707", "signature": "deposit(uint256)", "before": 48712, "after": 48390 }
  ],
  "simulatedAt": "2026-10-25T09:12:31Z"
}
```

`changes` is a discriminated union on `kind`: `implementation_changed`, `selector_added`, `selector_removed`, `owner_changed`, `role_granted`, `role_revoked`, `approval_changed`, `balance_changed`, `storage_changed`.

If execution reverts, sim still returns `200` with `success: false` and `revertReason`. Reverts are evidence too. `502 UPSTREAM_UNAVAILABLE` means the Hardhat node is unreachable.

---

## backend: Express on :4000

Swagger UI at `GET /docs`, OpenAPI JSON at `GET /docs.json`.

### `GET /health` → `HealthResponse`

```json
{ "service": "backend", "status": "ok", "version": "0.1.0", "mocks": true, "deps": { "postgres": "ok", "redis": "ok", "rag": "ok", "sim": "ok", "rpc": "ok" } }
```
`status` is `degraded` when any dependency is `down`.

### `GET /proposals` → `ProposalListResponse`

```json
{
  "proposals": [
    {
      "id": "MIP-21",
      "title": "MIP-21: MeridianReserve gas optimisation",
      "proposer": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      "governorProposalId": "71240117917747628806640772231852050840836735106339123343864741404726318379014",
      "operationId": "0x1479f0221f839edab5b6bd6509e1d8de7cd01691d05237a1ce45da57ad021396",
      "state": "queued",
      "analysisStatus": "done",
      "riskScore": 0.968,
      "riskLevel": "critical",
      "flagged": true,
      "createdAt": "2026-10-25T09:11:58Z",
      "updatedAt": "2026-10-25T09:12:40Z"
    }
  ]
}
```

### `GET /proposals/:id` → `ProposalDetail`

Everything the dashboard needs in one call: `proposal`, `onchain`, `documents`, `summary`, `intent`, `simulation`, `coi`, `voting`, `risk`, `evidence`, `flag`. Sections that have not run yet are omitted; `documents` and `evidence` are always present (possibly empty).

```json
{
  "proposal": { "id": "MIP-21", "state": "queued", "analysisStatus": "done", "flagged": true, "…": "…" },
  "onchain": { "operationId": "0x1479…1396", "…": "…" },
  "documents": [{ "id": "MIP-21:forum:0", "…": "…" }],
  "summary": { "…": "SummarizeResponse" },
  "intent": { "…": "ExtractIntentResponse" },
  "simulation": { "…": "SimulateResponse" },
  "coi": { "…": "CoiGraph" },
  "voting": { "…": "VotingSnapshot" },
  "risk": { "…": "RiskReport" },
  "evidence": { "…": "EvidenceTrail" },
  "flag": { "…": "FlagEvent" }
}
```
`404 NOT_FOUND` for an unknown id.

### `POST /proposals/:id/analyze`: `AnalyzeRequest` → `AnalyzeResponse` (202)

Enqueues the BullMQ pipeline: `ingest → summarize → extract_intent → simulate → coi → voting → score → commit → flag`. Progress streams over Socket.IO. The body is optional.

Request:
```json
{ "autoFlag": true }
```
Response `202`:
```json
{ "jobId": "an_01JB6Z4Q8R2K", "proposalId": "MIP-21", "status": "queued" }
```
`409 CONFLICT` if an analysis for this proposal is already queued or running.

### `GET /jobs/:jobId` → `AnalysisJob`

```json
{
  "jobId": "an_01JB6Z4Q8R2K",
  "proposalId": "MIP-21",
  "status": "running",
  "step": "simulate",
  "progress": 45,
  "queuedAt": "2026-10-25T09:11:58Z",
  "startedAt": "2026-10-25T09:11:59Z"
}
```

### `GET /proposals/:id/evidence` → `EvidenceTrail`

The hash chain: `entryHash = keccak256(abi.encode(uint256 index, bytes32 prevHash, string kind, bytes32 payloadHash))`, with `prevHash = 0x00…00` at index 0. The head is committed to the EvidenceRegistry contract. `verified` means every hash was recomputed and the head matches the latest on-chain commit.

```json
{
  "proposalId": "MIP-21",
  "entries": [
    {
      "proposalId": "MIP-21", "index": 0, "kind": "source_document", "refId": "MIP-21:forum:0",
      "payloadHash": "0xb9dc02a4ea65633c3f431cf8b57381d90bc6ed4920ef0ce0bdd796a98da6ea0d",
      "prevHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "entryHash": "0x3e1f…a9c2",
      "createdAt": "2026-10-25T09:12:04Z"
    },
    {
      "proposalId": "MIP-21", "index": 7, "kind": "risk", "refId": "an_01JB6Z4Q8R2K",
      "payloadHash": "0x77d0…41be", "prevHash": "0xc4a8…0e13", "entryHash": "0x5b92…d7f0",
      "commit": {
        "registry": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
        "txHash": "0x8f3a…11cd", "blockNumber": 44, "committedAt": "2026-10-25T09:12:38Z"
      },
      "createdAt": "2026-10-25T09:12:36Z"
    }
  ],
  "head": "0x5b92…d7f0",
  "verified": true
}
```

### `GET /proposals/:id/coi` → `CoiGraph`

```json
{
  "proposalId": "MIP-21",
  "nodes": [
    { "address": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "label": "kestrel.eth", "roles": ["proposer", "voter"], "votingPower": "120000000000000000000000" },
    { "address": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "label": "kestrel alt", "roles": ["alt_wallet", "beneficiary"] },
    { "address": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "label": "MeridianReserve", "roles": ["contract"] }
  ],
  "links": [
    { "from": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "to": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "kind": "social_claim", "confidence": 0.85, "evidence": "@kestrel_builds: \"moving my ops to a fresh wallet 0x9F2C…\"", "documentId": "MIP-21:social:0" },
    { "from": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "to": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "kind": "funded_by", "confidence": 0.9, "evidence": "First ETH received from the proposer, 1.0 ETH at block 12", "txHash": "0xc20e616d64958e8a427432bb8ba2fe709de60a462db7cfa055a9d0d18e9d8e22" },
    { "from": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "to": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "kind": "beneficiary_of", "confidence": 1, "evidence": "Simulation: becomes owner and unlimited USDC spender of the Reserve" }
  ],
  "findings": [
    { "id": "coi-1", "summary": "Proposer's alt wallet is the sole beneficiary of the executed changes", "addresses": ["0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B"], "probability": 0.88, "severity": "critical" }
  ]
}
```

### `GET /proposals/:id/voting` → `VotingSnapshot`

```json
{
  "proposalId": "MIP-21",
  "snapshotBlock": 20,
  "deadlineBlock": 35,
  "forVotes": "390000000000000000000000",
  "againstVotes": "40000000000000000000000",
  "abstainVotes": "0",
  "quorum": "400000000000000000000000",
  "totalSupply": "10000000000000000000000000",
  "votes": [
    { "voter": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "support": "for", "weight": "120000000000000000000000", "linkedToProposer": true }
  ]
}
```

### `GET /proposals/:id/risk` → `RiskReport`

Four chained Bayesian updates. Each stage's `prior` is the previous `posterior`, posterior odds = prior odds × `likelihoodRatio`, and a stage's ratio is the product of its signals' ratios.

```json
{
  "proposalId": "MIP-21",
  "baseRate": 0.05,
  "stages": [
    { "stage": "claims", "prior": 0.05, "likelihoodRatio": 1.2, "posterior": 0.0594,
      "signals": [{ "id": "claims-unverified-upgrade", "description": "Upgrade to a new implementation justified only as gas optimisation", "likelihoodRatio": 1.2, "evidenceIndex": 5 }] },
    { "stage": "coi", "prior": 0.0594, "likelihoodRatio": 8, "posterior": 0.3357,
      "signals": [
        { "id": "coi-social-alt", "description": "Proposer publicly claims 0x9F2C…fb7B as their new wallet", "likelihoodRatio": 4, "evidenceIndex": 2 },
        { "id": "coi-funded-by", "description": "0x9F2C…fb7B was funded by the proposer", "likelihoodRatio": 2 }
      ] },
    { "stage": "voting", "prior": 0.3357, "likelihoodRatio": 1.5, "posterior": 0.4311,
      "signals": [{ "id": "voting-self-weight", "description": "31% of For votes come from the proposer cluster", "likelihoodRatio": 1.5 }] },
    { "stage": "execution", "prior": 0.4311, "likelihoodRatio": 40, "posterior": 0.9681,
      "signals": [
        { "id": "exec-owner-contradiction", "description": "Owner changes despite 'no change to ownership'", "likelihoodRatio": 10, "evidenceIndex": 6 },
        { "id": "exec-unlimited-approval", "description": "Undisclosed unlimited USDC approval", "likelihoodRatio": 2, "evidenceIndex": 6 },
        { "id": "exec-drain-selector", "description": "Undisclosed migrateReserves(address) added", "likelihoodRatio": 2, "evidenceIndex": 6 }
      ] }
  ],
  "posterior": 0.9681,
  "level": "critical",
  "deviations": [
    {
      "id": "dev-1", "type": "contradicts_claim", "claimId": "c2", "severity": "critical",
      "explanation": "Text promises no change to ownership; execution makes 0x9F2C…fb7B the Reserve owner.",
      "change": { "kind": "owner_changed", "contract": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", "contractLabel": "MeridianReserve", "before": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", "after": "0x9F2C188225BaBb8aC51c8B49c850678558fEfb7B", "severity": "critical", "description": "Owner changed from TimelockController to 0x9F2C…fb7B" }
    },
    { "id": "dev-2", "type": "undisclosed_change", "severity": "critical", "explanation": "Unlimited USDC approval to the proposer's alt wallet is not mentioned anywhere.", "change": { "kind": "approval_changed", "…": "…" } },
    { "id": "dev-3", "type": "undisclosed_change", "severity": "high", "explanation": "migrateReserves(address) lets the owner move all reserves; not mentioned anywhere.", "change": { "kind": "selector_added", "…": "…" } }
  ],
  "recommendation": "flag",
  "computedAt": "2026-10-25T09:12:36Z"
}
```
Level thresholds: `< 0.25` low, `< 0.5` medium, `< 0.8` high, else critical. `recommendation` is `flag` when any deviation is `critical` or the posterior is ≥ 0.8.

### `POST /proposals/:id/flag`: `FlagRequest` → `FlagEvent` (201)

Manually calls `GovernanceGuard.flag(operationId, keccak256(reason))` from the watchdog account. The pipeline makes the same call automatically (`auto: true`) when `recommendation` is `flag` and `autoFlag` is on.

Request:
```json
{ "reason": "Execution contradicts claim c2 (no change to ownership): owner -> 0x9F2C…fb7B" }
```
Response `201`:
```json
{
  "proposalId": "MIP-21",
  "operationId": "0x1479f0221f839edab5b6bd6509e1d8de7cd01691d05237a1ce45da57ad021396",
  "reason": "Execution contradicts claim c2 (no change to ownership): owner -> 0x9F2C…fb7B",
  "reasonHash": "0x2d6b…c08e",
  "guard": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  "txHash": "0x9be1…74aa",
  "blockNumber": 45,
  "flaggedBy": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "auto": false,
  "flaggedAt": "2026-10-25T09:14:02Z"
}
```
`409 CONFLICT` if the operation is already flagged; `404 NOT_FOUND` if the proposal has no `operationId` yet (not queued).

---

## backend Socket.IO (same origin as :4000)

Clients emit `subscribe` with `{ "proposalId": "MIP-21" }` to join room `proposal:MIP-21`. Server events are typed by `SocketEventMap`:

| Event | Payload | When |
|---|---|---|
| `analysis:progress` | `AnalysisProgressEvent` | each pipeline step starts, completes or fails |
| `evidence:appended` | `EvidenceEntry` | a new link is added to the chain (and again once committed) |
| `analysis:completed` | `AnalysisCompletedEvent` | the risk report is final |
| `proposal:flagged` | `FlagEvent` | `GovernanceGuard.flag()` is mined |

```json
{ "jobId": "an_01JB6Z4Q8R2K", "proposalId": "MIP-21", "step": "simulate", "status": "completed", "progress": 55, "message": "5 state changes, 2 critical", "at": "2026-10-25T09:12:31Z" }
```

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
