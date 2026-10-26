// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProposalRegistry
/// @notice Tamper-evident, append-only history of proposal versions. Each commit must name the
/// current latest versionHash as its prevHash (bytes32(0) for the first), so history can only be
/// extended, never rewritten or forked. The address that commits version 1 owns that proposal's chain.
///
/// Technical assessments sit beside the versions: anyone may attest the hash of a simulation report for a
/// recorded proposal, and the attester is stored with it, so readers decide whose assessments they trust
/// (the ProofOfIntent watchdog attests one when the proposal is submitted and one for the exact queued payload).
contract ProposalRegistry {
    struct Assessment {
        bytes32 reportHash;
        bytes32 simHash;
        string uri;
        address attester;
        uint64 attestedAt;
    }

    mapping(uint256 proposalId => Assessment[]) private _assessments;

    event AssessmentAttested(
        uint256 indexed proposalId,
        uint256 index,
        bytes32 reportHash,
        bytes32 simHash,
        string uri,
        address indexed attester
    );

    error EmptyReportHash();
    error UnknownProposal(uint256 proposalId);

    struct Version {
        bytes32 versionHash;
        bytes32 prevHash;
        bytes32 evidenceRoot;
        string uri;
        address committer;
        uint64 committedAt;
    }

    mapping(uint256 proposalId => bytes32) public latestVersionHash;
    mapping(uint256 proposalId => Version[]) private _versions;

    event ProposalCommitted(
        uint256 indexed proposalId,
        uint256 version,
        bytes32 versionHash,
        bytes32 prevHash,
        bytes32 evidenceRoot,
        string uri,
        address indexed committer
    );

    error StalePrevHash(bytes32 expected, bytes32 got);
    error NotCommitter(address expected, address got);
    error EmptyVersionHash();
    error UnknownVersion(uint256 proposalId, uint256 version);

    /// @return version 1-based number of the new version
    function commit(uint256 proposalId, bytes32 versionHash, bytes32 prevHash, bytes32 evidenceRoot, string calldata uri)
        external
        returns (uint256 version)
    {
        if (versionHash == bytes32(0)) revert EmptyVersionHash();
        bytes32 latest = latestVersionHash[proposalId];
        if (prevHash != latest) revert StalePrevHash(latest, prevHash);

        Version[] storage history = _versions[proposalId];
        if (history.length > 0 && history[0].committer != msg.sender) {
            revert NotCommitter(history[0].committer, msg.sender);
        }

        history.push(Version(versionHash, prevHash, evidenceRoot, uri, msg.sender, uint64(block.timestamp)));
        latestVersionHash[proposalId] = versionHash;
        version = history.length;
        emit ProposalCommitted(proposalId, version, versionHash, prevHash, evidenceRoot, uri, msg.sender);
    }

    /// @param version 1-based version number
    function getVersion(uint256 proposalId, uint256 version)
        external
        view
        returns (bytes32 versionHash, bytes32 prevHash, bytes32 evidenceRoot, string memory uri, address committer)
    {
        Version[] storage history = _versions[proposalId];
        if (version == 0 || version > history.length) revert UnknownVersion(proposalId, version);
        Version storage v = history[version - 1];
        return (v.versionHash, v.prevHash, v.evidenceRoot, v.uri, v.committer);
    }

    /// @return versionHashes every versionHash in commit order (index 0 = version 1)
    function getHistory(uint256 proposalId) external view returns (bytes32[] memory versionHashes) {
        Version[] storage history = _versions[proposalId];
        versionHashes = new bytes32[](history.length);
        for (uint256 i = 0; i < history.length; i++) {
            versionHashes[i] = history[i].versionHash;
        }
    }

    function versionCount(uint256 proposalId) external view returns (uint256) {
        return _versions[proposalId].length;
    }

    /// @notice Records the hash of a technical assessment (simulation report) of a recorded proposal.
    /// @param reportHash sha256 of the report bytes
    /// @param simHash the simulation run the report describes
    /// @return index 0-based position in the proposal's assessment log
    function attest(uint256 proposalId, bytes32 reportHash, bytes32 simHash, string calldata uri)
        external
        returns (uint256 index)
    {
        if (reportHash == bytes32(0)) revert EmptyReportHash();
        if (_versions[proposalId].length == 0) revert UnknownProposal(proposalId);
        Assessment[] storage log = _assessments[proposalId];
        index = log.length;
        log.push(Assessment(reportHash, simHash, uri, msg.sender, uint64(block.timestamp)));
        emit AssessmentAttested(proposalId, index, reportHash, simHash, uri, msg.sender);
    }

    function assessmentCount(uint256 proposalId) external view returns (uint256) {
        return _assessments[proposalId].length;
    }

    /// @param index 0-based
    function getAssessment(uint256 proposalId, uint256 index)
        external
        view
        returns (bytes32 reportHash, bytes32 simHash, string memory uri, address attester, uint64 attestedAt)
    {
        Assessment[] storage log = _assessments[proposalId];
        if (index >= log.length) revert UnknownVersion(proposalId, index);
        Assessment storage a = log[index];
        return (a.reportHash, a.simHash, a.uri, a.attester, a.attestedAt);
    }
}
