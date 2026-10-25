// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VaultV1} from "./VaultV1.sol";

/// @title VaultPackedBase
/// @notice The genuine storage optimisation shared by VaultV2 and VaultV2Honest: depositCap and
/// lastRebalance move from two V1 slots into one packed slot in a NEW ERC-7201 namespace, so every
/// deposit/withdraw reads and writes one slot instead of two. The V1 layout is untouched (upgrade-safe);
/// _migrateToPacked() copies the values across and zeroes the old slots.
abstract contract VaultPackedBase is VaultV1 {
    /// @custom:storage-location erc7201:meridian.vault.v2
    struct PackedStorage {
        uint128 depositCap;
        uint64 lastRebalance;
    }

    // keccak256(abi.encode(uint256(keccak256("meridian.vault.v2")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_V2_STORAGE = 0xaa8634d17b9301b000b8c41d1ba899594da262070749970466aa941171ca3100;

    function version() external pure virtual override returns (string memory) {
        return "2.0.0";
    }

    function _migrateToPacked() internal {
        VaultStorage storage v1 = _vaultStorage();
        PackedStorage storage p = _packedStorage();
        p.depositCap = SafeCast.toUint128(v1.depositCap);
        p.lastRebalance = SafeCast.toUint64(v1.lastRebalance);
        v1.depositCap = 0;
        v1.lastRebalance = 0;
    }

    function _depositCap() internal view override returns (uint256) {
        return _packedStorage().depositCap;
    }

    function _setDepositCap(uint256 cap) internal override {
        _packedStorage().depositCap = SafeCast.toUint128(cap);
        emit DepositCapSet(cap);
    }

    function _lastRebalance() internal view override returns (uint256) {
        return _packedStorage().lastRebalance;
    }

    function _touch() internal override {
        _packedStorage().lastRebalance = uint64(block.timestamp);
    }

    function _packedStorage() private pure returns (PackedStorage storage $) {
        assembly {
            $.slot := VAULT_V2_STORAGE
        }
    }
}
