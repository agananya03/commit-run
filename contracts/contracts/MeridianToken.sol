// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title MeridianToken (MRD)
/// @notice Governance token of the fictional Meridian DAO. Fixed 100M supply minted once.
/// Voting power only counts after a holder delegates (to themselves or someone else).
contract MeridianToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 ether;

    constructor(address initialHolder) ERC20("Meridian", "MRD") ERC20Permit("Meridian") {
        _mint(initialHolder, INITIAL_SUPPLY);
    }

    // Overrides required by Solidity for ERC20Votes + ERC20Permit.

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
