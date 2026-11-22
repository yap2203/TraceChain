// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';

/// @notice Discovery and lifecycle only. Claim verification and business acceptance are separate.
contract CompanyProofRegistry {
    IStakeholderRegistry public immutable stakeholders;
    struct Proof {
        address verifier; address presenter; bytes32 challengeHash;
        bytes32 requestHash; string requestCid; uint64 expiresAt;
        bytes32 responseHash; string responseCid; uint8 status;
    }
    mapping(bytes32 => Proof) private proofs;
    struct Binding { bytes32 sourceHash; bytes32 contentHash; string cid; }
    mapping(address => Binding) public bindings;
    event Requested(bytes32 indexed requestId, address indexed verifier, address indexed presenter);
    event Responded(bytes32 indexed requestId, bytes32 responseHash, string responseCid);
    event Reviewed(bytes32 indexed requestId, uint8 status);
    error InvalidState(); error Unauthorized();
    constructor(IStakeholderRegistry registry) { if (address(registry).code.length == 0) revert InvalidState(); stakeholders = registry; }
    function registerBinding(bytes32 sourceHash, bytes32 contentHash, string calldata cid) external {
        _active(msg.sender);
        if (sourceHash != stakeholders.credentialHashOf(msg.sender) || contentHash == bytes32(0) || bytes(cid).length == 0) revert InvalidState();
        bindings[msg.sender] = Binding(sourceHash, contentHash, cid);
    }
    function _active(address wallet) private view { if (stakeholders.roleOf(wallet) == 0) revert Unauthorized(); }
    function request(bytes32 requestId, address presenter, bytes32 challengeHash, uint64 expiresAt, bytes32 requestHash, string calldata requestCid) external {
        _active(msg.sender); _active(presenter);
        Proof storage p = proofs[requestId];
        if (p.status != 0 && p.verifier != msg.sender) revert Unauthorized();
        if (p.status != 0 && p.expiresAt > block.timestamp) {
            if (p.verifier == msg.sender && p.presenter == presenter && p.requestHash == requestHash && keccak256(bytes(p.requestCid)) == keccak256(bytes(requestCid))) return;
            revert InvalidState();
        }
        if (requestId == bytes32(0) || presenter == msg.sender || challengeHash == bytes32(0) || expiresAt <= block.timestamp || requestHash == bytes32(0) || bytes(requestCid).length == 0) revert InvalidState();
        proofs[requestId] = Proof(msg.sender, presenter, challengeHash, requestHash, requestCid, expiresAt, bytes32(0), '', 1);
        emit Requested(requestId, msg.sender, presenter);
    }
    function respond(bytes32 requestId, bytes32 challengeHash, bytes32 responseHash, string calldata responseCid) external {
        Proof storage p = proofs[requestId]; _active(msg.sender); _active(p.verifier);
        if (p.presenter != msg.sender) revert Unauthorized();
        if (p.expiresAt <= block.timestamp || p.challengeHash != challengeHash || responseHash == bytes32(0) || bytes(responseCid).length == 0) revert InvalidState();
        if (p.status == 2 && p.responseHash == responseHash && keccak256(bytes(p.responseCid)) == keccak256(bytes(responseCid))) return;
        if (p.status != 1) revert InvalidState();
        p.responseHash = responseHash; p.responseCid = responseCid; p.status = 2;
        emit Responded(requestId, responseHash, responseCid);
    }
    function review(bytes32 requestId, bool declined) external {
        Proof storage p = proofs[requestId]; _active(msg.sender); _active(p.presenter);
        if (declined) { if (p.presenter != msg.sender || p.status != 1) revert Unauthorized(); p.status = 4; }
        else { if (p.verifier != msg.sender || p.status != 2 || p.expiresAt <= block.timestamp) revert Unauthorized(); p.status = 3; }
        emit Reviewed(requestId, p.status);
    }
    function get(bytes32 requestId) external view returns (Proof memory) { return proofs[requestId]; }
}
