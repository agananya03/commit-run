// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultPackedBase} from "./VaultPackedBase.sol";

/// @title VaultV2Honest
/// @notice What MIP-21 claims to be: the same storage packing as VaultV2, with no ownership change
/// and no new privileged functions. Used in tests as the control case.
/// @dev Upgrade target for an already-initialized proxy, so no initializer of its own.
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract VaultV2Honest is VaultPackedBase {
    function reinitializeV2() external reinitializer(2) {
        _migrateToPacked();
    }
}
