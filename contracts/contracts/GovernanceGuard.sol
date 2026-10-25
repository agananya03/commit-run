// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GovernanceGuard
/// @notice Lets a watchdog DELAY a queued timelock operation, never execute or change it.
/// - flag(): WATCHDOG_ROLE only, once per operation; the flag expires after FLAG_TTL.
/// - clear(): only the timelock itself, i.e. a passed governance vote overrides the watchdog.
/// - A cleared operation cannot be flagged again, so the override vote is final.
/// The timelock is DEFAULT_ADMIN_ROLE, so only governance can add or remove watchdogs.
contract GovernanceGuard is AccessControl {
    bytes32 public constant WATCHDOG_ROLE = keccak256("WATCHDOG_ROLE");
    uint256 public constant FLAG_TTL = 7 days;

    struct Flag {
        bytes32 findingsHash;
        address watchdog;
        uint64 flaggedAt;
        bool cleared;
    }

    address public immutable timelock;
    mapping(bytes32 operationId => Flag) public flags;

    event Flagged(bytes32 indexed operationId, bytes32 findingsHash, address indexed watchdog);
    event Cleared(bytes32 indexed operationId);

    error NotTimelock(address caller);
    error AlreadyFlagged(bytes32 operationId);
    error AlreadyCleared(bytes32 operationId);
    error NotFlagged(bytes32 operationId);

    constructor(address timelock_, address watchdog) {
        timelock = timelock_;
        _grantRole(DEFAULT_ADMIN_ROLE, timelock_);
        if (watchdog != address(0)) _grantRole(WATCHDOG_ROLE, watchdog);
    }

    function flag(bytes32 operationId, bytes32 findingsHash) external onlyRole(WATCHDOG_ROLE) {
        Flag storage f = flags[operationId];
        if (f.cleared) revert AlreadyCleared(operationId);
        // One flag per operation: re-flagging after expiry would let a watchdog block forever.
        if (f.flaggedAt != 0) revert AlreadyFlagged(operationId);
        flags[operationId] = Flag(findingsHash, msg.sender, uint64(block.timestamp), false);
        emit Flagged(operationId, findingsHash, msg.sender);
    }

    function clear(bytes32 operationId) external {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        if (!isFlagged(operationId)) revert NotFlagged(operationId);
        flags[operationId].cleared = true;
        emit Cleared(operationId);
    }

    function isFlagged(bytes32 operationId) public view returns (bool) {
        Flag storage f = flags[operationId];
        return f.flaggedAt != 0 && !f.cleared && block.timestamp < uint256(f.flaggedAt) + FLAG_TTL;
    }
}
