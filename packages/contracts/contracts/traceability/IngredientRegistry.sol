// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {ICredentialRegistry} from '../interfaces/ICredentialRegistry.sol';
import {IIngredientRegistry} from '../interfaces/IIngredientRegistry.sol';

contract IngredientRegistry is IIngredientRegistry {
    enum Status {
        None,
        Active,
        Suspended,
        Recalled
    }
    struct Batch {
        address supplier;
        bytes32 metadataHash;
        string encryptedCid;
        bytes32 credentialId;
        uint256 totalQuantity;
        uint256 availableQuantity;
        bytes32 unit;
        uint64 producedAt;
        uint64 expiresAt;
        Status status;
    }
    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();
    IStakeholderRegistry public immutable stakeholders;
    ICredentialRegistry public immutable credentials;
    address public productRegistry;
    mapping(bytes32 => Batch) private batches;
    event IngredientBatchRegistered(
        bytes32 indexed batchId,
        address indexed supplier,
        bytes32 indexed credentialId,
        uint256 quantity,
        bytes32 metadataHash,
        string encryptedCid
    );
    event IngredientConsumed(
        bytes32 indexed batchId,
        bytes32 indexed productBatchId,
        uint256 quantity
    );
    event IngredientStatusChanged(bytes32 indexed batchId, Status status, bytes32 reasonHash);
    constructor(address stakeholderRegistry, address credentialRegistry) {
        stakeholders = IStakeholderRegistry(stakeholderRegistry);
        credentials = ICredentialRegistry(credentialRegistry);
    }
    function configureProductRegistry(address registry) external {
        if (
            !stakeholders.isAuthorized(msg.sender, 1) ||
            registry.code.length == 0 ||
            productRegistry != address(0)
        ) revert Unauthorized(msg.sender);
        productRegistry = registry;
    }
    function registerBatch(
        bytes32 batchId,
        bytes32 metadataHash,
        string calldata encryptedCid,
        bytes32 credentialId,
        uint256 quantity,
        bytes32 unit,
        uint64 producedAt,
        uint64 expiresAt
    ) external {
        if (!stakeholders.hasPermission(msg.sender, keccak256('REGISTER_INGREDIENT')))
            revert Unauthorized(msg.sender);
        if (
            batchId == bytes32(0) ||
            metadataHash == bytes32(0) ||
            credentialId == bytes32(0) ||
            quantity == 0 ||
            unit == bytes32(0) ||
            producedAt > block.timestamp ||
            expiresAt <= block.timestamp ||
            batches[batchId].status != Status.None ||
            !credentials.isCredentialValid(credentialId) ||
            credentials.credentialSubject(credentialId) != msg.sender ||
            credentials.credentialTypeOf(credentialId) != 2
        ) revert InvalidInput();
        batches[batchId] = Batch(
            msg.sender,
            metadataHash,
            encryptedCid,
            credentialId,
            quantity,
            quantity,
            unit,
            producedAt,
            expiresAt,
            Status.Active
        );
        emit IngredientBatchRegistered(
            batchId,
            msg.sender,
            credentialId,
            quantity,
            metadataHash,
            encryptedCid
        );
    }
    function consumeIngredient(
        bytes32 batchId,
        uint256 quantity,
        bytes32 productBatchId
    ) external override {
        if (msg.sender != productRegistry) revert Unauthorized(msg.sender);
        Batch storage batch = batches[batchId];
        if (!isUsable(batchId) || quantity == 0 || batch.availableQuantity < quantity)
            revert InvalidState();
        batch.availableQuantity -= quantity;
        emit IngredientConsumed(batchId, productBatchId, quantity);
    }
    function setStatus(bytes32 batchId, Status status, bytes32 reasonHash) external {
        Batch storage batch = batches[batchId];
        if (msg.sender != batch.supplier && !stakeholders.isAuthorized(msg.sender, 1))
            revert Unauthorized(msg.sender);
        if (batch.status == Status.None || batch.status == Status.Recalled || status == Status.None)
            revert InvalidState();
        batch.status = status;
        emit IngredientStatusChanged(batchId, status, reasonHash);
    }
    function isUsable(bytes32 batchId) public view override returns (bool) {
        Batch storage batch = batches[batchId];
        return batch.availableQuantity > 0 && isValidTraceabilitySource(batchId);
    }
    function evidenceDetails(bytes32 batchId)
        external
        view
        override
        returns (address supplier, bytes32 credentialId, bool validTraceabilitySource)
    {
        Batch storage batch = batches[batchId];
        if (batch.status == Status.None) revert InvalidInput();
        return (batch.supplier, batch.credentialId, isValidTraceabilitySource(batchId));
    }
    function isValidTraceabilitySource(bytes32 batchId) public view override returns (bool) {
        Batch storage batch = batches[batchId];
        return
            batch.status == Status.Active &&
            batch.expiresAt > block.timestamp &&
            stakeholders.isAuthorized(batch.supplier, 2) &&
            credentials.isCredentialValid(batch.credentialId);
    }
    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        if (batches[batchId].status == Status.None) revert InvalidInput();
        return batches[batchId];
    }
}
