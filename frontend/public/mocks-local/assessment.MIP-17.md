# Technical assessment: MIP-17 (payload as proposed)

- Simulation: succeeded
- simHash: `0x172a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590`
- bytecodeHash: `0x0000000000000000000000000000000000000000000000000000000000000000`
- Fork block: chain head
- findingsHash: `0x0ef1369e1a18cbfa0500b4b6983bdcd381e2e0e5bfd839b1f6ea39d1697bf6ad`

## Calls

| # | Target | Function |
|---|---|---|
| 1 | Treasury | `transfer(address,uint256)` |

## State changes

### Ownership

None.

### Token approvals

None.

### Token transfers

- `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` → `0xFABB0ac9d68B0B445fB7357272Ff202C5651694a`: 5000000000000 of `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

### Code upgrades

None.

## Promise vs code

- **HIGH amount_mismatch** (fnd-17-1). Said: "Total Itemized Budget Allocation: $3,500,000 USDC". Does: Treasury.transfer of 5,000,000 USDC to wallet index 12 ($1.5M undeclared surplus)
- **HIGH coi** (fnd-17-2). Said: "Nexus Labs is an independent engineering collective". Does: Hidden fund transfer path from proposer wallet 10 through intermediary 11 to recipient wallet 12

