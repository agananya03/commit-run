# contracts

Hardhat (TypeScript) + OpenZeppelin Contracts v5 project for Meridian DAO on **:8545** (chainId 31337, default Hardhat mnemonic).

- **DAO core:** MeridianToken (MRD, ERC20Votes), MockUSDC (6 decimals), MeridianGovernor (Governor + TimelockControl), Treasury (owned by the timelock), VaultV1 (UUPS, owner = timelock).
- **Accountability:** ProposalRegistry (`commit(proposalId, versionHash, prevHash, evidenceRoot, uri)`, rejects a stale `prevHash`), GovernanceGuard (`flag(operationId, findingsHash)` for WATCHDOG_ROLE, `clear` only by the timelock), GuardedTimelock (reverts `execute` while flagged).
- **Scenario contracts:** VaultV2 (malicious MIP-21 upgrade) and VaultV2Honest (tests).

Writes `deployments/localhost.json` (addresses, ABIs, deploy block), which the backend and rag read.

Owner: C (Parvati). Status: not started.
