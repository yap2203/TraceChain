// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {ICredentialRegistry} from '../interfaces/ICredentialRegistry.sol';

contract EvidenceRegistry {
    enum RequestStatus {
        None,
        AwaitingResponse,
        EvidenceReceived,
        Accepted,
        Declined,
        Rejected,
        Cancelled
    }
    struct Request {
        address requester;
        address supplier;
        bytes32 ingredientBatchId;
        bytes32 claimsHash;
        bytes32 challengeHash;
        string requestCid;
        string presentationCid;
        bytes32 presentationHash;
        RequestStatus status;
        uint64 dueAt;
        uint64 presentationExpiresAt;
        uint64 updatedAt;
    }
    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();
    IStakeholderRegistry public immutable stakeholders;
    ICredentialRegistry public immutable credentials;
    mapping(bytes32 => Request) private requests;
    mapping(bytes32 => mapping(address => bool)) public acceptedForManufacturer;
    mapping(bytes32 => bool) public consumedChallenge;
    event EvidenceRequested(
        bytes32 indexed requestId,
        address indexed requester,
        address indexed supplier,
        bytes32 ingredientBatchId,
        bytes32 claimsHash,
        bytes32 challengeHash,
        string requestCid,
        uint64 dueAt
    );
    event EvidenceResponded(
        bytes32 indexed requestId,
        bytes32 presentationHash,
        string presentationCid,
        uint64 expiresAt
    );
    event EvidenceStatusChanged(
        bytes32 indexed requestId,
        RequestStatus status,
        bytes32 reasonHash
    );
    constructor(address stakeholderRegistry, address credentialRegistry) {
        if (stakeholderRegistry == address(0) || credentialRegistry == address(0))
            revert InvalidInput();
        stakeholders = IStakeholderRegistry(stakeholderRegistry);
        credentials = ICredentialRegistry(credentialRegistry);
    }
    function requestEvidence(
        bytes32 requestId,
        address supplier,
        bytes32 ingredientBatchId,
        bytes32 claimsHash,
        bytes32 challengeHash,
        string calldata requestCid,
        uint64 dueAt
    ) external {
        if (!stakeholders.hasPermission(msg.sender, keccak256('REQUEST_EVIDENCE')))
            revert Unauthorized(msg.sender);
        if (
            !stakeholders.isAuthorized(supplier, 2) ||
            requestId == bytes32(0) ||
            ingredientBatchId == bytes32(0) ||
            claimsHash == bytes32(0) ||
            challengeHash == bytes32(0) ||
            dueAt <= block.timestamp ||
            requests[requestId].status != RequestStatus.None
        ) revert InvalidInput();
        requests[requestId] = Request(
            msg.sender,
            supplier,
            ingredientBatchId,
            claimsHash,
            challengeHash,
            requestCid,
            '',
            bytes32(0),
            RequestStatus.AwaitingResponse,
            dueAt,
            0,
            uint64(block.timestamp)
        );
        emit EvidenceRequested(
            requestId,
            msg.sender,
            supplier,
            ingredientBatchId,
            claimsHash,
            challengeHash,
            requestCid,
            dueAt
        );
    }
    function respond(
        bytes32 requestId,
        bytes32 presentationHash,
        string calldata presentationCid,
        uint64 expiresAt
    ) external {
        Request storage request = _request(requestId);
        if (msg.sender != request.supplier) revert Unauthorized(msg.sender);
        if (
            request.status != RequestStatus.AwaitingResponse ||
            block.timestamp > request.dueAt ||
            expiresAt <= block.timestamp ||
            presentationHash == bytes32(0) ||
            consumedChallenge[request.challengeHash]
        ) revert InvalidState();
        request.presentationHash = presentationHash;
        request.presentationCid = presentationCid;
        request.presentationExpiresAt = expiresAt;
        request.status = RequestStatus.EvidenceReceived;
        request.updatedAt = uint64(block.timestamp);
        consumedChallenge[request.challengeHash] = true;
        emit EvidenceResponded(requestId, presentationHash, presentationCid, expiresAt);
    }
    function accept(bytes32 requestId, bytes32 ingredientCredentialId) external {
        Request storage request = _request(requestId);
        if (msg.sender != request.requester) revert Unauthorized(msg.sender);
        if (
            request.status != RequestStatus.EvidenceReceived ||
            request.presentationExpiresAt <= block.timestamp ||
            !credentials.isCredentialValid(ingredientCredentialId)
        ) revert InvalidState();
        request.status = RequestStatus.Accepted;
        request.updatedAt = uint64(block.timestamp);
        acceptedForManufacturer[request.ingredientBatchId][request.requester] = true;
        emit EvidenceStatusChanged(requestId, request.status, bytes32(0));
    }
    function close(bytes32 requestId, RequestStatus status, bytes32 reasonHash) external {
        Request storage request = _request(requestId);
        if (msg.sender != request.requester && msg.sender != request.supplier)
            revert Unauthorized(msg.sender);
        if (
            status != RequestStatus.Declined &&
            status != RequestStatus.Rejected &&
            status != RequestStatus.Cancelled
        ) revert InvalidInput();
        if (
            request.status != RequestStatus.AwaitingResponse &&
            request.status != RequestStatus.EvidenceReceived
        ) revert InvalidState();
        request.status = status;
        request.updatedAt = uint64(block.timestamp);
        emit EvidenceStatusChanged(requestId, status, reasonHash);
    }
    function getRequest(bytes32 requestId) external view returns (Request memory) {
        return _request(requestId);
    }
    function _request(bytes32 id) private view returns (Request storage request) {
        request = requests[id];
        if (request.status == RequestStatus.None) revert InvalidInput();
    }
}
