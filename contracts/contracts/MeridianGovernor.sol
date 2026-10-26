// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MeridianGovernor
/// @notice proposeWithEvidence -> vote (1 block delay, 20 block period, 4% quorum) -> queue in the timelock -> execute.
/// Execution happens from the timelock, so the timelock (not this contract) owns the Treasury and Vault.
///
/// No proposal without evidence and a disclosure: plain propose() is closed. Every proposal must name the Merkle
/// root of its evidence files (the root ProposalRegistry commits) and the proposer's own disclosure of the wallets
/// they control or are paid by, sent from the proposer's wallet (the transaction is the signature). The root is
/// appended to the description, so the proposal id the DAO votes on is itself a fingerprint of that evidence.
contract MeridianGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    struct Evidence {
        bytes32 evidenceRoot;
        address[] disclosedWallets;
        string disclosureUri;
    }

    mapping(uint256 proposalId => Evidence) private _evidence;

    event EvidenceBound(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 evidenceRoot,
        address[] disclosedWallets,
        string disclosureUri
    );

    error EvidenceRequired();
    error EmptyEvidenceRoot();

    constructor(IVotes token, TimelockController timelock)
        Governor("MeridianGovernor")
        GovernorSettings(1, /* votingDelay: blocks */ 20, /* votingPeriod: blocks */ 0 /* proposalThreshold */)
        GovernorVotes(token)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(timelock)
    {}

    /// @notice Closed: use proposeWithEvidence.
    function propose(address[] memory, uint256[] memory, bytes[] memory, string memory)
        public
        pure
        override
        returns (uint256)
    {
        revert EvidenceRequired();
    }

    /// @param evidenceRoot Merkle root of the proposal's evidence files (leaves [fileType, sha256])
    /// @param disclosedWallets wallets the proposer controls or is financially tied to (may be empty: "none")
    /// @param disclosureUri where the full disclosure statement lives
    function proposeWithEvidence(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        bytes32 evidenceRoot,
        address[] calldata disclosedWallets,
        string calldata disclosureUri
    ) public returns (uint256 proposalId) {
        if (evidenceRoot == bytes32(0)) revert EmptyEvidenceRoot();
        address proposer = _msgSender();
        string memory bound = boundDescription(description, evidenceRoot);
        if (!_isValidDescriptionForProposer(proposer, bound)) revert GovernorRestrictedProposer(proposer);
        uint256 votesThreshold = proposalThreshold();
        if (votesThreshold > 0) {
            uint256 proposerVotes = getVotes(proposer, clock() - 1);
            if (proposerVotes < votesThreshold) revert GovernorInsufficientProposerVotes(proposer, proposerVotes, votesThreshold);
        }

        proposalId = _propose(targets, values, calldatas, bound, proposer);
        Evidence storage e = _evidence[proposalId];
        e.evidenceRoot = evidenceRoot;
        e.disclosedWallets = disclosedWallets;
        e.disclosureUri = disclosureUri;
        emit EvidenceBound(proposalId, proposer, evidenceRoot, disclosedWallets, disclosureUri);
    }

    /// @notice The description proposeWithEvidence stores (queue/execute/hashProposal need its keccak256).
    function boundDescription(string memory description, bytes32 evidenceRoot) public pure returns (string memory) {
        return string.concat(description, "\n\nevidence: ", Strings.toHexString(uint256(evidenceRoot), 32));
    }

    function evidenceOf(uint256 proposalId)
        external
        view
        returns (bytes32 evidenceRoot, address[] memory disclosedWallets, string memory disclosureUri)
    {
        Evidence storage e = _evidence[proposalId];
        return (e.evidenceRoot, e.disclosedWallets, e.disclosureUri);
    }

    // Overrides required by Solidity.

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 timepoint) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(timepoint);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}
