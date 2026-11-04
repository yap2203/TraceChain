// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IIngredientRegistry} from '../interfaces/IIngredientRegistry.sol';
import {IProductRegistry} from '../interfaces/IProductRegistry.sol';
import {EvidenceRegistry} from './EvidenceRegistry.sol';

contract ProductRegistry is IProductRegistry {
    enum Status {
        None,
        Active,
        Suspended,
        Recalled
    }
    struct Product {
        address manufacturer;
        bytes32 metadataHash;
        string publicCid;
        uint256 totalQuantity;
        bytes32 unit;
        uint64 producedAt;
        uint64 expiresAt;
        Status status;
    }
    struct IngredientLink {
        bytes32 batchId;
        uint256 quantity;
    }
    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();
    IStakeholderRegistry public immutable stakeholders;
    IIngredientRegistry public immutable ingredients;
    EvidenceRegistry public immutable evidence;
    mapping(bytes32 => Product) private products;
    mapping(bytes32 => IngredientLink[]) private links;
    event ProductCreated(
        bytes32 indexed batchId,
        address indexed manufacturer,
        uint256 quantity,
        bytes32 metadataHash,
        string publicCid
    );
    event IngredientLinked(
        bytes32 indexed productBatchId,
        bytes32 indexed ingredientBatchId,
        uint256 quantity
    );
    event ProductStatusChanged(bytes32 indexed batchId, Status status, bytes32 reasonHash);
    constructor(address stakeholderRegistry, address ingredientRegistry, address evidenceRegistry) {
        stakeholders = IStakeholderRegistry(stakeholderRegistry);
        ingredients = IIngredientRegistry(ingredientRegistry);
        evidence = EvidenceRegistry(evidenceRegistry);
    }
    function createProduct(
        bytes32 batchId,
        bytes32 metadataHash,
        string calldata publicCid,
        uint256 quantity,
        bytes32 unit,
        uint64 producedAt,
        uint64 expiresAt,
        bytes32[] calldata ingredientIds,
        uint256[] calldata quantities
    ) external {
        if (!stakeholders.isAuthorized(msg.sender, 3)) revert Unauthorized(msg.sender);
        if (
            batchId == bytes32(0) ||
            metadataHash == bytes32(0) ||
            quantity == 0 ||
            unit == bytes32(0) ||
            producedAt > block.timestamp ||
            expiresAt <= block.timestamp ||
            products[batchId].status != Status.None ||
            ingredientIds.length == 0 ||
            ingredientIds.length != quantities.length
        ) revert InvalidInput();
        products[batchId] = Product(
            msg.sender,
            metadataHash,
            publicCid,
            quantity,
            unit,
            producedAt,
            expiresAt,
            Status.Active
        );
        _linkIngredients(batchId, ingredientIds, quantities);
        emit ProductCreated(batchId, msg.sender, quantity, metadataHash, publicCid);
    }
    function setStatus(bytes32 batchId, Status status, bytes32 reasonHash) external {
        Product storage product = products[batchId];
        if (msg.sender != product.manufacturer && !stakeholders.isAuthorized(msg.sender, 1))
            revert Unauthorized(msg.sender);
        if (
            product.status == Status.None ||
            product.status == Status.Recalled ||
            status == Status.None
        ) revert InvalidState();
        product.status = status;
        emit ProductStatusChanged(batchId, status, reasonHash);
    }
    function isTransferable(bytes32 batchId) external view override returns (bool) {
        Product storage product = products[batchId];
        if (
            product.status != Status.Active ||
            product.expiresAt <= block.timestamp ||
            !stakeholders.isAuthorized(product.manufacturer, 3)
        ) return false;
        for (uint256 i; i < links[batchId].length; ++i)
            if (!ingredients.isUsable(links[batchId][i].batchId)) return false;
        return true;
    }
    function manufacturerOf(bytes32 id) external view override returns (address) {
        return products[id].manufacturer;
    }
    function totalQuantityOf(bytes32 id) external view override returns (uint256) {
        return products[id].totalQuantity;
    }
    function getProduct(bytes32 id) external view returns (Product memory) {
        if (products[id].status == Status.None) revert InvalidInput();
        return products[id];
    }
    function getIngredientLinks(bytes32 id) external view returns (IngredientLink[] memory) {
        return links[id];
    }
    function _linkIngredients(
        bytes32 productBatchId,
        bytes32[] calldata ingredientIds,
        uint256[] calldata quantities
    ) private {
        for (uint256 i; i < ingredientIds.length; ++i) {
            bytes32 ingredientId = ingredientIds[i];
            uint256 ingredientQuantity = quantities[i];
            if (
                !ingredients.isUsable(ingredientId) ||
                !evidence.acceptedForManufacturer(ingredientId, msg.sender) ||
                ingredientQuantity == 0
            ) revert InvalidState();
            ingredients.consumeIngredient(ingredientId, ingredientQuantity, productBatchId);
            links[productBatchId].push(IngredientLink(ingredientId, ingredientQuantity));
            emit IngredientLinked(productBatchId, ingredientId, ingredientQuantity);
        }
    }
}
