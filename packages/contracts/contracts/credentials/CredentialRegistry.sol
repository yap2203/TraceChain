// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ICredentialRegistry} from '../interfaces/ICredentialRegistry.sol';
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';

contract CredentialRegistry is ICredentialRegistry {
    enum CredentialType {
        None,
        CompanyRole,
        Ingredient,
        EvidencePresentation
    }
    enum CredentialStatus {
        None,
        Active,
        Suspended,
        Revoked
    }
    struct CredentialRecord {
        bytes32 credentialHash;
        string encryptedCid;
        address issuer;
        address subject;
        CredentialType credentialType;
        CredentialStatus status;
        uint64 issuedAt;
        uint64 expiresAt;
        uint64 updatedAt;
    }

    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();

    IStakeholderRegistry public immutable stakeholderRegistry;
    mapping(bytes32 => CredentialRecord) private credentials;
    mapping(bytes32 => bytes32) public override credentialIdByHash;
    mapping(bytes32 => bool) private administratorSuspension;

    event CredentialRegistered(
        bytes32 indexed credentialId,
        bytes32 indexed credentialHash,
        address indexed subject,
        address issuer,
        CredentialType credentialType,
        string encryptedCid,
        uint64 expiresAt
    );
    event CredentialStatusChanged(
        bytes32 indexed credentialId,
        CredentialStatus status,
        address indexed actor,
        bytes32 reasonHash
    );
    event CredentialReferenceUpdated(bytes32 indexed credentialId, string encryptedCid);

    constructor(address stakeholderRegistryAddress) {
        if (stakeholderRegistryAddress == address(0)) revert InvalidInput();
        stakeholderRegistry = IStakeholderRegistry(stakeholderRegistryAddress);
    }

    function registerCredential(
        bytes32 credentialId,
        bytes32 credentialHash,
        string calldata encryptedCid,
        address subject,
        CredentialType credentialType,
        uint64 expiresAt
    ) external {
        if (
            credentialId == bytes32(0) ||
            credentialHash == bytes32(0) ||
            subject == address(0) ||
            credentialType == CredentialType.None ||
            expiresAt <= block.timestamp
        ) revert InvalidInput();
        if (
            credentials[credentialId].status != CredentialStatus.None ||
            credentialIdByHash[credentialHash] != bytes32(0)
        ) revert InvalidState();
        if (!_canIssue(msg.sender, credentialType)) revert Unauthorized(msg.sender);
        credentials[credentialId] = CredentialRecord(
            credentialHash,
            encryptedCid,
            msg.sender,
            subject,
            credentialType,
            CredentialStatus.Active,
            uint64(block.timestamp),
            expiresAt,
            uint64(block.timestamp)
        );
        credentialIdByHash[credentialHash] = credentialId;
        emit CredentialRegistered(
            credentialId,
            credentialHash,
            subject,
            msg.sender,
            credentialType,
            encryptedCid,
            expiresAt
        );
    }

    function updateEncryptedCid(bytes32 credentialId, string calldata encryptedCid) external {
        CredentialRecord storage record = _record(credentialId);
        if (!_canManage(msg.sender, record) || record.status == CredentialStatus.Revoked)
            revert Unauthorized(msg.sender);
        record.encryptedCid = encryptedCid;
        record.updatedAt = uint64(block.timestamp);
        emit CredentialReferenceUpdated(credentialId, encryptedCid);
    }
    function suspendCredential(bytes32 credentialId, bytes32 reasonHash) external {
        CredentialRecord storage record = _record(credentialId);
        if (!_canManage(msg.sender, record) || record.status != CredentialStatus.Active)
            revert InvalidState();
        record.status = CredentialStatus.Suspended;
        administratorSuspension[credentialId] = stakeholderRegistry.isAuthorized(msg.sender, 1);
        record.updatedAt = uint64(block.timestamp);
        emit CredentialStatusChanged(credentialId, record.status, msg.sender, reasonHash);
    }
    function reactivateCredential(bytes32 credentialId) external {
        CredentialRecord storage record = _record(credentialId);
        if (
            !_canManage(msg.sender, record) ||
            record.status != CredentialStatus.Suspended ||
            record.expiresAt <= block.timestamp ||
            (administratorSuspension[credentialId] &&
                !stakeholderRegistry.isAuthorized(msg.sender, 1))
        ) revert InvalidState();
        record.status = CredentialStatus.Active;
        administratorSuspension[credentialId] = false;
        record.updatedAt = uint64(block.timestamp);
        emit CredentialStatusChanged(credentialId, record.status, msg.sender, bytes32(0));
    }
    function revokeCredential(bytes32 credentialId, bytes32 reasonHash) external {
        CredentialRecord storage record = _record(credentialId);
        if (!_canManage(msg.sender, record) || record.status == CredentialStatus.Revoked)
            revert InvalidState();
        record.status = CredentialStatus.Revoked;
        record.updatedAt = uint64(block.timestamp);
        emit CredentialStatusChanged(credentialId, record.status, msg.sender, reasonHash);
    }

    function isCredentialValid(bytes32 credentialId) public view override returns (bool) {
        CredentialRecord storage record = credentials[credentialId];
        if (
            record.status != CredentialStatus.Active ||
            record.expiresAt <= block.timestamp
        ) return false;
        if (record.credentialType == CredentialType.CompanyRole)
            return
                stakeholderRegistry.isActive(record.subject) &&
                stakeholderRegistry.credentialHashOf(record.subject) == record.credentialHash;
        return
            stakeholderRegistry.isActive(record.issuer) &&
            stakeholderRegistry.isAuthorized(record.issuer, 2);
    }
    function effectiveStatus(bytes32 credentialId) external view returns (CredentialStatus) {
        CredentialRecord storage record = credentials[credentialId];
        return
            record.status == CredentialStatus.Active && record.expiresAt <= block.timestamp
                ? CredentialStatus.Revoked
                : record.status;
    }
    function credentialSubject(bytes32 credentialId) external view override returns (address) {
        return credentials[credentialId].subject;
    }
    function credentialTypeOf(bytes32 credentialId) external view override returns (uint8) {
        return uint8(credentials[credentialId].credentialType);
    }
    function getCredential(bytes32 credentialId) external view returns (CredentialRecord memory) {
        return _record(credentialId);
    }

    function _record(bytes32 id) private view returns (CredentialRecord storage record) {
        record = credentials[id];
        if (record.status == CredentialStatus.None) revert InvalidInput();
    }
    function _canIssue(address issuer, CredentialType credentialType) private view returns (bool) {
        return
            credentialType == CredentialType.CompanyRole
                ? stakeholderRegistry.isAuthorized(issuer, 1)
                : stakeholderRegistry.hasPermission(issuer, keccak256('ISSUE_INGREDIENT_CREDENTIAL'));
    }
    function _canManage(
        address actor,
        CredentialRecord storage record
    ) private view returns (bool) {
        return
            stakeholderRegistry.isAuthorized(actor, 1) ||
            (actor == record.issuer &&
                record.credentialType != CredentialType.CompanyRole &&
                stakeholderRegistry.hasPermission(actor, keccak256('ISSUE_INGREDIENT_CREDENTIAL')));
    }
}
