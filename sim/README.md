# sim

Express + TypeScript simulation service on **:4002**. Simulates a proposal's `targets/values/calldatas` as the timelock on an Anvil fork (**:8546**) of the Hardhat node and reports facts: decoded calls, token transfers, approvals, ownership and EIP-1967 implementation changes, added/removed selectors, events and storage diffs. It never decides what is malicious; the backend's verdict engine does.

Endpoints: `POST /simulate`, `GET /deployments`, `POST /reset`. Response shapes: [`/shared/schemas/types.ts`](../shared/schemas/types.ts) (`SimulationResult`).

Owner: C (Parvati). Status: not started.
