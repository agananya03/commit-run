# Technical assessment: MIP-12 (payload as proposed)

- Simulation: succeeded
- simHash: `0x122a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590`
- bytecodeHash: `0x0000000000000000000000000000000000000000000000000000000000000000`
- Fork block: chain head
- findingsHash: `0x518674ab2b227e5f11e9084f615d57663cde47bce1ba168b4c19c7ee22a73d70`

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

- `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` → `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720`: 400000000000 of `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

### Code upgrades

None.

## Promise vs code

The simulated execution matches the stated intent: no findings.

