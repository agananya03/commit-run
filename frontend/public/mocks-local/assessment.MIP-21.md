# Technical assessment: MIP-21 (payload as proposed)

- Simulation: succeeded
- simHash: `0x892a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590`
- bytecodeHash: `0xd4e29bf424072387140f00f8da790516b23a5bb7097a4a9058b8ef7c7a364be1`
- Fork block: chain head
- findingsHash: `0x160261ee853466d5ea857d785f7c8a4019c1af3914f053bbb9e92011c503ecd5`

## Calls

| # | Target | Function |
|---|---|---|
| 1 | VaultProxy | `upgradeToAndCall(address,bytes)` |
| 2 | Treasury | `approve(address,address,uint256)` |

## State changes

### Ownership

- owner of `0x0165878A594ca255338adfa4d48449f69242Eb8F`: `0x0000000000000000000000000000000000000000` → `0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097`

### Token approvals

- `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` lets `0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097` spend unlimited (2^256 − 1) of `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

### Token transfers

None.

### Code upgrades

- `0x0165878A594ca255338adfa4d48449f69242Eb8F`: `0x5FbDB2315678afecb367f032d93F642f64180aa3` → `0x17F24d3B8bc1150553b54Da30B4d993ACb889212`; added: reinitializeV2(address), migrateReserves(address,uint256); removed: none

## Promise vs code

- **CRITICAL ownership_change** (fnd-1). Said: "This is purely a gas optimisation, with no change to ownership. Storage layout is preserved and the Timelock stays in control of the Vault.". Does: reinitializeV2 transfers Vault ownership to wallet 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097 (wallet index 14)
- **CRITICAL unlimited_approval** (fnd-2). Said: "Changes are limited to slot packing and EIP-2929 warm-access savings.". Does: Calls Treasury.approve(USDC, 0xdF3e..., MaxUint256) granting unlimited allowance on the DAO liquid reserve
- **CRITICAL new_privileged_function** (fnd-3). Said: "Changes are limited to slot packing and EIP-2929 warm-access savings.". Does: Adds migrateReserves and reinitializeV2 backdoor functions allowing instant reserve draining

