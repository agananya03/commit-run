// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Treasury
/// @notice Holds Meridian DAO's USDC and ETH. Owned by the timelock, so funds only move through a
/// passed governance proposal. token == address(0) means native ETH in transfer().
contract Treasury is Ownable {
    using SafeERC20 for IERC20;

    event Sent(address indexed token, address indexed to, uint256 amount);
    event Approved(address indexed token, address indexed spender, uint256 amount);
    event Received(address indexed from, uint256 amount);

    error EthTransferFailed(address to, uint256 amount);

    constructor(address timelock) Ownable(timelock) {}

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function transfer(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Sent(token, to, amount);
    }

    function approve(address token, address spender, uint256 amount) external onlyOwner {
        IERC20(token).forceApprove(spender, amount);
        emit Approved(token, spender, amount);
    }
}
