// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {ICredentialRegistry} from '../interfaces/ICredentialRegistry.sol';

contract StakeholderRegistry is IStakeholderRegistry {
    enum Role {
        None,
        SystemAdmin,
        Supplier,
        Manufacturer,
        Distributor,
        Retailer
    }
    enum StakeholderStatus {
        None,
        Active,
        Suspended,
        Revoked
    }
    enum ApplicationStatus {
        None,
        Pending,
        AdditionalEvidenceRequired,
        Approved,
        Rejected,
        Withdrawn
    }

    struct Stakeholder {
        Role role;
        StakeholderStatus status;
        bytes32 credentialHash;
        string credentialCid;
        uint64 credentialExpiresAt;
        uint64 updatedAt;
    }

    struct Application {
        address applicant;
        Role requestedRole;
        ApplicationStatus status;
        bytes32 profileHash;
        string encryptedProfileCid;
        bytes32 previousApplicationId;
        uint64 submittedAt;
        uint64 updatedAt;
    }

    struct RoleChangeRequest {
        address stakeholder;
        Role currentRole;
        Role requestedRole;
        ApplicationStatus status;
        bytes32 evidenceHash;
        string encryptedEvidenceCid;
        uint64 submittedAt;
        uint64 updatedAt;
    }

    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();
    error AlreadyRegistered(address account);
    error ApplicationNotFound(bytes32 applicationId);

    address public override administrator;
    address public pendingAdministrator;
    ICredentialRegistry public credentialRegistry;
    mapping(address => Stakeholder) private stakeholders;
    mapping(bytes32 => Application) private applications;
    bytes32[] private applicationIds;
    mapping(bytes32 => RoleChangeRequest) private roleChangeRequests;
    mapping(Role => mapping(bytes32 => bool)) private rolePermissions;
    // 0 inherits the role default, 1 allows, 2 denies. Scoped to a role-assignment epoch
    // so a role change or replacement wallet cannot inherit stale exceptions.
    mapping(address => uint256) private permissionEpoch;
    mapping(address => mapping(uint256 => mapping(bytes32 => uint8))) private personalPermissions;
    event PersonalPermissionChanged(
        address indexed account, Role indexed role, bytes32 indexed permission, uint8 setting
    );
    bytes32[] private roleChangeRequestIds;

    event ApplicationSubmitted(
        bytes32 indexed applicationId,
        address indexed applicant,
        Role indexed role,
        bytes32 profileHash,
        string encryptedProfileCid,
        bytes32 previousApplicationId
    );
    event ApplicationStatusChanged(
        bytes32 indexed applicationId,
        ApplicationStatus status,
        bytes32 reasonHash,
        string requestCid
    );
    event StakeholderRegistered(
        address indexed account,
        Role indexed role,
        bytes32 indexed credentialHash
    );
    event StakeholderStatusChanged(
        address indexed account,
        StakeholderStatus status,
        bytes32 reasonHash
    );
    event CredentialReferenceUpdated(
        address indexed account,
        bytes32 indexed oldHash,
        bytes32 indexed newHash,
        string credentialCid,
        uint64 expiresAt
    );
    event WalletReplaced(address indexed oldWallet, address indexed newWallet, Role indexed role);
    event AdministratorTransferStarted(
        address indexed currentAdministrator,
        address indexed pendingAdministrator
    );
    event AdministratorTransferred(
        address indexed previousAdministrator,
        address indexed newAdministrator
    );
    event CredentialRegistryConfigured(address indexed registry);
    event RolePermissionChanged(Role indexed role, bytes32 indexed permission, bool allowed);
    event RoleChangeSubmitted(
        bytes32 indexed requestId,
        address indexed stakeholder,
        Role indexed requestedRole,
        bytes32 evidenceHash,
        string encryptedEvidenceCid
    );
    event RoleChangeStatusChanged(
        bytes32 indexed requestId,
        ApplicationStatus status,
        bytes32 reasonHash
    );
    event StakeholderRoleChanged(
        address indexed account,
        Role indexed previousRole,
        Role indexed newRole,
        bytes32 credentialHash
    );

    constructor(address initialAdministrator) {
        if (initialAdministrator == address(0)) revert InvalidInput();
        administrator = initialAdministrator;
        stakeholders[initialAdministrator] = Stakeholder(
            Role.SystemAdmin,
            StakeholderStatus.Active,
            bytes32(0),
            '',
            0,
            uint64(block.timestamp)
        );
        emit StakeholderRegistered(initialAdministrator, Role.SystemAdmin, bytes32(0));
        _setDefaultPermissions();
    }

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized(msg.sender);
        _;
    }

    function configureCredentialRegistry(address registry) external onlyAdministrator {
        if (registry.code.length == 0 || address(credentialRegistry) != address(0))
            revert InvalidState();
        credentialRegistry = ICredentialRegistry(registry);
        emit CredentialRegistryConfigured(registry);
    }

    function submitApplication(
        bytes32 applicationId,
        bytes32 profileHash,
        string calldata encryptedProfileCid,
        Role requestedRole,
        bytes32 previousApplicationId
    ) external {
        if (
            applicationId == bytes32(0) ||
            profileHash == bytes32(0) ||
            requestedRole < Role.Supplier ||
            requestedRole > Role.Retailer
        ) revert InvalidInput();
        if (applications[applicationId].status != ApplicationStatus.None) revert InvalidState();
        if (stakeholders[msg.sender].status == StakeholderStatus.Active)
            revert AlreadyRegistered(msg.sender);
        if (previousApplicationId != bytes32(0)) {
            Application storage previous = applications[previousApplicationId];
            if (previous.applicant != msg.sender || previous.status != ApplicationStatus.Rejected)
                revert InvalidState();
        }
        applications[applicationId] = Application(
            msg.sender,
            requestedRole,
            ApplicationStatus.Pending,
            profileHash,
            encryptedProfileCid,
            previousApplicationId,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        applicationIds.push(applicationId);
        emit ApplicationSubmitted(
            applicationId,
            msg.sender,
            requestedRole,
            profileHash,
            encryptedProfileCid,
            previousApplicationId
        );
    }

    function withdrawApplication(bytes32 applicationId) external {
        Application storage application = _application(applicationId);
        if (application.applicant != msg.sender) revert Unauthorized(msg.sender);
        if (
            application.status != ApplicationStatus.Pending &&
            application.status != ApplicationStatus.AdditionalEvidenceRequired
        ) revert InvalidState();
        _setApplicationStatus(
            applicationId,
            application,
            ApplicationStatus.Withdrawn,
            bytes32(0),
            ''
        );
    }

    function requestAdditionalEvidence(
        bytes32 applicationId,
        bytes32 requestHash,
        string calldata requestCid
    ) external onlyAdministrator {
        Application storage application = _application(applicationId);
        if (application.status != ApplicationStatus.Pending || requestHash == bytes32(0))
            revert InvalidState();
        _setApplicationStatus(
            applicationId,
            application,
            ApplicationStatus.AdditionalEvidenceRequired,
            requestHash,
            requestCid
        );
    }

    function resubmitEvidence(
        bytes32 applicationId,
        bytes32 newProfileHash,
        string calldata newEncryptedProfileCid
    ) external {
        Application storage application = _application(applicationId);
        if (application.applicant != msg.sender) revert Unauthorized(msg.sender);
        if (
            application.status != ApplicationStatus.AdditionalEvidenceRequired ||
            newProfileHash == bytes32(0)
        ) revert InvalidState();
        application.profileHash = newProfileHash;
        application.encryptedProfileCid = newEncryptedProfileCid;
        _setApplicationStatus(
            applicationId,
            application,
            ApplicationStatus.Pending,
            bytes32(0),
            ''
        );
    }

    function approveApplication(
        bytes32 applicationId,
        bytes32 credentialHash,
        string calldata credentialCid,
        uint64 credentialExpiresAt
    ) external onlyAdministrator {
        Application storage application = _application(applicationId);
        if (application.status != ApplicationStatus.Pending) revert InvalidState();
        _validateCredential(credentialHash, credentialExpiresAt);
        if (stakeholders[application.applicant].status != StakeholderStatus.None)
            revert AlreadyRegistered(application.applicant);
        stakeholders[application.applicant] = Stakeholder(
            application.requestedRole,
            StakeholderStatus.Active,
            credentialHash,
            credentialCid,
            credentialExpiresAt,
            uint64(block.timestamp)
        );
        _setApplicationStatus(
            applicationId,
            application,
            ApplicationStatus.Approved,
            bytes32(0),
            ''
        );
        emit StakeholderRegistered(
            application.applicant,
            application.requestedRole,
            credentialHash
        );
    }

    function rejectApplication(
        bytes32 applicationId,
        bytes32 reasonHash
    ) external onlyAdministrator {
        Application storage application = _application(applicationId);
        if (application.status != ApplicationStatus.Pending || reasonHash == bytes32(0))
            revert InvalidState();
        _setApplicationStatus(
            applicationId,
            application,
            ApplicationStatus.Rejected,
            reasonHash,
            ''
        );
    }

    function submitRoleChange(
        bytes32 requestId,
        Role requestedRole,
        bytes32 evidenceHash,
        string calldata encryptedEvidenceCid
    ) external {
        Stakeholder storage stakeholder = stakeholders[msg.sender];
        if (!_lifecycleActive(stakeholder) || stakeholder.role == Role.SystemAdmin)
            revert Unauthorized(msg.sender);
        if (
            requestId == bytes32(0) ||
            evidenceHash == bytes32(0) ||
            requestedRole < Role.Supplier ||
            requestedRole > Role.Retailer ||
            requestedRole == stakeholder.role
        ) revert InvalidInput();
        if (roleChangeRequests[requestId].status != ApplicationStatus.None) revert InvalidState();
        roleChangeRequests[requestId] = RoleChangeRequest(
            msg.sender,
            stakeholder.role,
            requestedRole,
            ApplicationStatus.Pending,
            evidenceHash,
            encryptedEvidenceCid,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        roleChangeRequestIds.push(requestId);
        emit RoleChangeSubmitted(
            requestId,
            msg.sender,
            requestedRole,
            evidenceHash,
            encryptedEvidenceCid
        );
    }

    function approveRoleChange(
        bytes32 requestId,
        bytes32 replacementCredentialHash,
        string calldata replacementCredentialCid,
        uint64 credentialExpiresAt
    ) external onlyAdministrator {
        RoleChangeRequest storage request = _roleChangeRequest(requestId);
        Stakeholder storage stakeholder = stakeholders[request.stakeholder];
        if (
            request.status != ApplicationStatus.Pending ||
            stakeholder.status != StakeholderStatus.Active ||
            stakeholder.role != request.currentRole
        ) revert InvalidState();
        _validateCredential(replacementCredentialHash, credentialExpiresAt);
        Role previousRole = stakeholder.role;
        ++permissionEpoch[request.stakeholder];
        stakeholder.role = request.requestedRole;
        stakeholder.credentialHash = replacementCredentialHash;
        stakeholder.credentialCid = replacementCredentialCid;
        stakeholder.credentialExpiresAt = credentialExpiresAt;
        stakeholder.updatedAt = uint64(block.timestamp);
        request.status = ApplicationStatus.Approved;
        request.updatedAt = uint64(block.timestamp);
        emit RoleChangeStatusChanged(requestId, ApplicationStatus.Approved, bytes32(0));
        emit StakeholderRoleChanged(
            request.stakeholder,
            previousRole,
            request.requestedRole,
            replacementCredentialHash
        );
    }

    function rejectRoleChange(bytes32 requestId, bytes32 reasonHash) external onlyAdministrator {
        RoleChangeRequest storage request = _roleChangeRequest(requestId);
        if (request.status != ApplicationStatus.Pending || reasonHash == bytes32(0))
            revert InvalidState();
        request.status = ApplicationStatus.Rejected;
        request.updatedAt = uint64(block.timestamp);
        emit RoleChangeStatusChanged(requestId, ApplicationStatus.Rejected, reasonHash);
    }

    function updateCredentialReference(
        address account,
        bytes32 newHash,
        string calldata newCid,
        uint64 expiresAt
    ) external onlyAdministrator {
        Stakeholder storage stakeholder = stakeholders[account];
        if (
            stakeholder.status == StakeholderStatus.None ||
            stakeholder.status == StakeholderStatus.Revoked
        ) revert InvalidState();
        _validateCredential(newHash, expiresAt);
        bytes32 oldHash = stakeholder.credentialHash;
        stakeholder.credentialHash = newHash;
        stakeholder.credentialCid = newCid;
        stakeholder.credentialExpiresAt = expiresAt;
        stakeholder.updatedAt = uint64(block.timestamp);
        emit CredentialReferenceUpdated(account, oldHash, newHash, newCid, expiresAt);
    }

    function suspendStakeholder(address account, bytes32 reasonHash) external onlyAdministrator {
        _changeStatus(account, StakeholderStatus.Active, StakeholderStatus.Suspended, reasonHash);
    }
    function reactivateStakeholder(address account) external onlyAdministrator {
        if (stakeholders[account].credentialExpiresAt <= block.timestamp) revert InvalidState();
        _changeStatus(account, StakeholderStatus.Suspended, StakeholderStatus.Active, bytes32(0));
    }
    function revokeStakeholder(address account, bytes32 reasonHash) external onlyAdministrator {
        _changeStatus(account, stakeholders[account].status, StakeholderStatus.Revoked, reasonHash);
    }

    function replaceWallet(
        address oldWallet,
        address newWallet,
        bytes32 newHash,
        string calldata newCid,
        uint64 expiresAt
    ) external onlyAdministrator {
        Stakeholder storage oldStakeholder = stakeholders[oldWallet];
        if (
            newWallet == address(0) ||
            newWallet == oldWallet ||
            stakeholders[newWallet].status != StakeholderStatus.None
        ) revert InvalidInput();
        if (
            (oldStakeholder.status != StakeholderStatus.Active &&
                oldStakeholder.status != StakeholderStatus.Suspended) ||
            oldStakeholder.role == Role.SystemAdmin
        ) revert InvalidState();
        _validateCredential(newHash, expiresAt);
        Role role = oldStakeholder.role;
        stakeholders[newWallet] = Stakeholder(
            role,
            StakeholderStatus.Active,
            newHash,
            newCid,
            expiresAt,
            uint64(block.timestamp)
        );
        oldStakeholder.role = Role.None;
        oldStakeholder.status = StakeholderStatus.Revoked;
        oldStakeholder.updatedAt = uint64(block.timestamp);
        emit WalletReplaced(oldWallet, newWallet, role);
    }

    function beginAdministratorTransfer(address nextAdministrator) external onlyAdministrator {
        if (
            nextAdministrator == address(0) ||
            nextAdministrator == administrator ||
            stakeholders[nextAdministrator].status != StakeholderStatus.None
        ) revert InvalidInput();
        pendingAdministrator = nextAdministrator;
        emit AdministratorTransferStarted(administrator, nextAdministrator);
    }
    function cancelAdministratorTransfer() external onlyAdministrator {
        pendingAdministrator = address(0);
        emit AdministratorTransferStarted(administrator, address(0));
    }
    function acceptAdministratorTransfer() external {
        if (
            msg.sender != pendingAdministrator ||
            stakeholders[msg.sender].status != StakeholderStatus.None
        ) revert Unauthorized(msg.sender);
        address previous = administrator;
        stakeholders[previous].role = Role.None;
        stakeholders[previous].status = StakeholderStatus.Revoked;
        stakeholders[previous].updatedAt = uint64(block.timestamp);
        administrator = msg.sender;
        pendingAdministrator = address(0);
        stakeholders[msg.sender] = Stakeholder(
            Role.SystemAdmin,
            StakeholderStatus.Active,
            bytes32(0),
            '',
            0,
            uint64(block.timestamp)
        );
        emit AdministratorTransferred(previous, msg.sender);
    }

    function roleOf(address account) external view override returns (uint8) {
        return _authorizedRole(account);
    }
    function isActive(address account) public view override returns (bool) {
        return _lifecycleActive(stakeholders[account]);
    }
    function isAuthorized(address account, uint8 role) external view override returns (bool) {
        return _authorizedRole(account) == role;
    }
    function hasPermission(address account, bytes32 permission) external view override returns (bool) {
        uint8 activeRole = _authorizedRole(account);
        if (activeRole == uint8(Role.SystemAdmin)) return true;
        if (activeRole == 0) return false;
        uint8 setting = personalPermissions[account][permissionEpoch[account]][permission];
        return setting == 1 || (setting == 0 && rolePermissions[Role(activeRole)][permission]);
    }
    function getPersonalPermission(address account, bytes32 permission) external view returns (uint8) {
        return personalPermissions[account][permissionEpoch[account]][permission];
    }
    function setPersonalPermission(address account, bytes32 permission, uint8 setting) external onlyAdministrator {
        Stakeholder storage stakeholder = stakeholders[account];
        if (
            stakeholder.role < Role.Supplier || stakeholder.role > Role.Retailer ||
            stakeholder.status == StakeholderStatus.Revoked || permission == bytes32(0) || setting > 2
        ) revert InvalidInput();
        personalPermissions[account][permissionEpoch[account]][permission] = setting;
        emit PersonalPermissionChanged(account, stakeholder.role, permission, setting);
    }
    function roleHasPermission(Role role, bytes32 permission) external view returns (bool) {
        return role == Role.SystemAdmin || rolePermissions[role][permission];
    }
    function setRolePermission(Role role, bytes32 permission, bool allowed) external onlyAdministrator {
        if (role < Role.Supplier || role > Role.Retailer || permission == bytes32(0)) revert InvalidInput();
        rolePermissions[role][permission] = allowed;
        emit RolePermissionChanged(role, permission, allowed);
    }
    function credentialHashOf(address account) external view override returns (bytes32) {
        return stakeholders[account].credentialHash;
    }
    function getStakeholder(address account) external view returns (Stakeholder memory) {
        return stakeholders[account];
    }
    function getApplication(bytes32 applicationId) external view returns (Application memory) {
        return _application(applicationId);
    }
    function applicationCount() external view returns (uint256) {
        return applicationIds.length;
    }
    function getApplicationIds(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory page) {
        uint256 end = offset + limit;
        if (end > applicationIds.length) end = applicationIds.length;
        if (offset >= end) return new bytes32[](0);
        page = new bytes32[](end - offset);
        for (uint256 i; i < page.length; ++i) page[i] = applicationIds[offset + i];
    }
    function getRoleChangeRequest(
        bytes32 requestId
    ) external view returns (RoleChangeRequest memory) {
        return _roleChangeRequest(requestId);
    }
    function roleChangeRequestCount() external view returns (uint256) {
        return roleChangeRequestIds.length;
    }
    function getRoleChangeRequestIds(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory page) {
        uint256 end = offset + limit;
        if (end > roleChangeRequestIds.length) end = roleChangeRequestIds.length;
        if (offset >= end) return new bytes32[](0);
        page = new bytes32[](end - offset);
        for (uint256 i; i < page.length; ++i) page[i] = roleChangeRequestIds[offset + i];
    }

    function _application(bytes32 id) private view returns (Application storage application) {
        application = applications[id];
        if (application.status == ApplicationStatus.None) revert ApplicationNotFound(id);
    }
    function _roleChangeRequest(
        bytes32 id
    ) private view returns (RoleChangeRequest storage request) {
        request = roleChangeRequests[id];
        if (request.status == ApplicationStatus.None) revert ApplicationNotFound(id);
    }
    function _setApplicationStatus(
        bytes32 id,
        Application storage application,
        ApplicationStatus status,
        bytes32 reasonHash,
        string memory requestCid
    ) private {
        application.status = status;
        application.updatedAt = uint64(block.timestamp);
        emit ApplicationStatusChanged(id, status, reasonHash, requestCid);
    }
    function _changeStatus(
        address account,
        StakeholderStatus expected,
        StakeholderStatus next,
        bytes32 reasonHash
    ) private {
        Stakeholder storage stakeholder = stakeholders[account];
        if (
            stakeholder.role == Role.SystemAdmin ||
            stakeholder.status == StakeholderStatus.None ||
            stakeholder.status == StakeholderStatus.Revoked
        ) revert InvalidState();
        if (next != StakeholderStatus.Revoked && stakeholder.status != expected)
            revert InvalidState();
        stakeholder.status = next;
        if (next == StakeholderStatus.Revoked) stakeholder.role = Role.None;
        stakeholder.updatedAt = uint64(block.timestamp);
        emit StakeholderStatusChanged(account, next, reasonHash);
    }
    function _validateCredential(bytes32 hash, uint64 expiresAt) private view {
        if (hash == bytes32(0) || expiresAt <= block.timestamp) revert InvalidInput();
    }
    function _lifecycleActive(Stakeholder storage stakeholder) private view returns (bool) {
        return
            stakeholder.status == StakeholderStatus.Active &&
            (stakeholder.role == Role.SystemAdmin ||
                stakeholder.credentialExpiresAt > block.timestamp);
    }
    function _authorizedRole(address account) private view returns (uint8) {
        Stakeholder storage stakeholder = stakeholders[account];
        if (!_lifecycleActive(stakeholder)) return 0;
        if (account == administrator) return uint8(Role.SystemAdmin);
        if (address(credentialRegistry) == address(0)) return 0;
        bytes32 credentialId = credentialRegistry.credentialIdByHash(stakeholder.credentialHash);
        if (
            credentialId == bytes32(0) ||
            credentialRegistry.credentialSubject(credentialId) != account ||
            credentialRegistry.credentialTypeOf(credentialId) != 1 ||
            !credentialRegistry.isCredentialValid(credentialId)
        ) return 0;
        return uint8(stakeholder.role);
    }
    function _setDefaultPermissions() private {
        rolePermissions[Role.Supplier][keccak256('REGISTER_INGREDIENT')] = true;
        rolePermissions[Role.Supplier][keccak256('ISSUE_INGREDIENT_CREDENTIAL')] = true;
        rolePermissions[Role.Manufacturer][keccak256('REQUEST_EVIDENCE')] = true;
        rolePermissions[Role.Retailer][keccak256('REQUEST_EVIDENCE')] = true;
        rolePermissions[Role.Manufacturer][keccak256('REGISTER_PRODUCT')] = true;
        rolePermissions[Role.Manufacturer][keccak256('INITIATE_TRANSFER')] = true;
        rolePermissions[Role.Distributor][keccak256('INITIATE_TRANSFER')] = true;
        rolePermissions[Role.Distributor][keccak256('RECEIVE_TRANSFER')] = true;
        rolePermissions[Role.Retailer][keccak256('RECEIVE_TRANSFER')] = true;
    }
}
