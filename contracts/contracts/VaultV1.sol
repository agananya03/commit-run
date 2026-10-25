// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title VaultV1
/// @notice Meridian DAO's USDC vault behind a UUPS proxy. Users deposit and withdraw their own USDC;
/// the DAO's reserves sit in the same contract. The owner (the timelock) can upgrade it and set the cap.
/// Storage is ERC-7201 namespaced so later versions can add state without layout collisions.
contract VaultV1 is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:meridian.vault.v1
    struct VaultStorage {
        IERC20 asset;
        uint256 totalDeposits;
        mapping(address account => uint256) balances;
        uint256 depositCap;
        uint256 lastRebalance;
    }

    // keccak256(abi.encode(uint256(keccak256("meridian.vault.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_V1_STORAGE = 0xe59881199c270bc43064570d90300f5496dbc57b99f5b5c465c11a84618b0900;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event DepositCapSet(uint256 cap);

    error ZeroAmount();
    error DepositCapExceeded(uint256 cap, uint256 attempted);
    error InsufficientBalance(uint256 available, uint256 requested);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IERC20 asset_, address owner_, uint256 depositCap_) external initializer {
        __Ownable_init(owner_);
        _vaultStorage().asset = asset_;
        _setDepositCap(depositCap_);
    }

    // --- user actions ---

    function deposit(uint256 amount) external virtual {
        if (amount == 0) revert ZeroAmount();
        VaultStorage storage $ = _vaultStorage();
        uint256 cap = _depositCap();
        if ($.totalDeposits + amount > cap) revert DepositCapExceeded(cap, $.totalDeposits + amount);

        $.balances[msg.sender] += amount;
        $.totalDeposits += amount;
        _touch();
        $.asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external virtual {
        if (amount == 0) revert ZeroAmount();
        VaultStorage storage $ = _vaultStorage();
        uint256 balance = $.balances[msg.sender];
        if (amount > balance) revert InsufficientBalance(balance, amount);

        $.balances[msg.sender] = balance - amount;
        $.totalDeposits -= amount;
        _touch();
        $.asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // --- owner (timelock) ---

    function setDepositCap(uint256 cap) external onlyOwner {
        _setDepositCap(cap);
    }

    // --- views ---

    function asset() external view returns (address) {
        return address(_vaultStorage().asset);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _vaultStorage().balances[account];
    }

    function totalDeposits() external view returns (uint256) {
        return _vaultStorage().totalDeposits;
    }

    /// @notice Everything the vault holds: user deposits plus DAO reserves.
    function reserves() external view returns (uint256) {
        return _vaultStorage().asset.balanceOf(address(this));
    }

    function depositCap() external view returns (uint256) {
        return _depositCap();
    }

    function lastRebalance() external view returns (uint256) {
        return _lastRebalance();
    }

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    // --- storage hooks (later versions may relocate these fields) ---

    function _depositCap() internal view virtual returns (uint256) {
        return _vaultStorage().depositCap;
    }

    function _setDepositCap(uint256 cap) internal virtual {
        _vaultStorage().depositCap = cap;
        emit DepositCapSet(cap);
    }

    function _lastRebalance() internal view virtual returns (uint256) {
        return _vaultStorage().lastRebalance;
    }

    /// @dev Records the time of the last balance change.
    function _touch() internal virtual {
        _vaultStorage().lastRebalance = block.timestamp;
    }

    function _vaultStorage() internal pure returns (VaultStorage storage $) {
        assembly {
            $.slot := VAULT_V1_STORAGE
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
