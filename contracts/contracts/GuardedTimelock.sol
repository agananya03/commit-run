// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GovernanceGuard} from "./GovernanceGuard.sol";

/// @title GuardedTimelock
/// @notice OpenZeppelin TimelockController that refuses to execute an operation while the
/// GovernanceGuard has it flagged. It deploys its own guard so the guard's `timelock` is this
/// contract from the start (no circular deploy, no setter to forget).
contract GuardedTimelock is TimelockController {
    GovernanceGuard public immutable guard;

    error GuardFlagged(bytes32 id);

    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin, address watchdog)
        TimelockController(minDelay, proposers, executors, admin)
    {
        guard = new GovernanceGuard(address(this), watchdog);
    }

    function execute(address target, uint256 value, bytes calldata payload, bytes32 predecessor, bytes32 salt)
        public
        payable
        override
    {
        _requireNotFlagged(hashOperation(target, value, payload, predecessor, salt));
        super.execute(target, value, payload, predecessor, salt);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt
    ) public payable override {
        _requireNotFlagged(hashOperationBatch(targets, values, payloads, predecessor, salt));
        super.executeBatch(targets, values, payloads, predecessor, salt);
    }

    function _requireNotFlagged(bytes32 id) private view {
        if (guard.isFlagged(id)) revert GuardFlagged(id);
    }
}
