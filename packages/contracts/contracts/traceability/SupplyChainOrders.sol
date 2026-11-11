// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IngredientRegistry} from './IngredientRegistry.sol';
import {ProductRegistry} from './ProductRegistry.sol';
import {EvidenceRegistry} from './EvidenceRegistry.sol';
import {CustodyTransfer} from './CustodyTransfer.sol';

/// Requests/proposals are distinct from reservations, physical dispatch and receipts.
/// Quantities remain integers in each batch's registered unit; no implicit conversion.
contract SupplyChainOrders {
    function catalogueUnitPolicy() external pure returns (uint8) { return 2; }
    function registeredRequestPolicy() external pure returns (uint8) { return 1; }
    function requestOnlyPolicy() external pure returns (uint8) { return 1; }
    function supplierManagementPolicy() external pure returns (uint8) { return 1; }
    struct Decision { uint8 status; bytes32 detailsHash; string encryptedCid; uint64 recordedAt; }
    mapping(bytes32 => Decision) public requestDecision;
    event RequestDecided(bytes32 indexed requestId, uint8 status, bytes32 detailsHash, string encryptedCid);
    function decideRequest(bytes32 requestId, uint8 decision, bytes32 detailsHash, string calldata cid) external {
        Order storage order = _seller(requestId);
        if (!requestOnly[requestId] || requestDecision[requestId].status != 0 || (decision != 1 && decision != 2) || detailsHash == bytes32(0) || bytes(cid).length == 0) revert InvalidState();
        requestDecision[requestId] = Decision(decision, detailsHash, cid, uint64(block.timestamp));
        if (decision == 2) order.status = 3;
        emit RequestDecided(requestId, decision, detailsHash, cid);
    }
    struct Item { address seller; uint8 kind; bytes32 unit; bytes32 metadataHash; string name; bool active; }
    struct Order {
        address buyer; address seller; bytes32 itemId; uint256 requested;
        bytes32 receivingLocation; uint64 expiresAt; uint8 status;
        bytes32 proposedBatch; bytes32 dispatchLocation; uint256 allocated; uint256 dispatched;
        bool evidenceRequired; bool identityRequired; bytes32 identityChallenge;
        bytes32 identityCredentialHash; uint64 identityValidUntil; bytes32 detailsHash; string detailsCid;
    }
    struct Shipment {
        bytes32 orderId; bytes32 batchId; address sender; address recipient;
        uint256 quantity; bytes32 fromLocation; bytes32 toLocation;
        uint64 occurredAt; uint64 recordedAt; uint8 status;
        uint256 accepted; uint256 damaged; uint256 rejected; uint256 missing;
        uint64 receivedAt; uint64 receiptRecordedAt;
    }
    struct Correction {
        bytes32 originalId; address actor; bytes32 reasonHash; bytes32 valuesHash;
        uint64 occurredAt; uint64 recordedAt; bool reconciliationRequired;
    }
    error Unauthorized(); error InvalidState(); error InvalidInput(); error InsufficientStock();
    IStakeholderRegistry public immutable stakeholders;
    IngredientRegistry public immutable ingredients;
    ProductRegistry public immutable products;
    EvidenceRegistry public immutable evidence;
    CustodyTransfer public immutable custody;
    mapping(bytes32 => Item) private items;
    mapping(bytes32 => bytes32) public batchItem;
    mapping(bytes32 => address) public locationOwner;
    mapping(bytes32 => bytes32) public locationDetailsHash;
    mapping(bytes32 => Order) private orders;
    mapping(bytes32 => bool) public requestOnly;
    mapping(bytes32 => Shipment) private shipments;
    mapping(bytes32 => bytes32[]) private orderShipments;
    mapping(bytes32 => bytes32[]) private orderEvidence;
    mapping(bytes32 => bool) private correctionUsed;
    mapping(bytes32 => uint64) public identityDeadline;
    mapping(bytes32 => bytes32) public evidenceOrder;
    mapping(bytes32 => uint256) public proposalEpoch;
    mapping(bytes32 => uint256) private evidenceEpoch;
    event ItemListed(bytes32 indexed itemId, address indexed seller, bytes32 indexed batchId);
    event LocationRegistered(bytes32 indexed location, address indexed company, bytes32 detailsHash);
    event OrderRequested(bytes32 indexed orderId, address indexed buyer, address indexed seller);
    event OrderChanged(bytes32 indexed orderId, uint8 status);
    event BatchProposed(bytes32 indexed orderId, bytes32 indexed batchId, bytes32 location, uint256 proposalVersion);
    event ShipmentDispatched(bytes32 indexed shipmentId, bytes32 indexed orderId, bytes32 indexed batchId);
    event ShipmentReceived(bytes32 indexed shipmentId, uint256 accepted, uint256 damaged, uint256 rejected, uint256 missing, uint64 occurredAt, uint64 recordedAt);
    event IdentityRequested(bytes32 indexed orderId, bytes32 challenge, bytes32 purposeHash, bytes32 claimsHash, uint64 expiresAt, bool required);
    event IdentityAttested(bytes32 indexed orderId, bytes32 presentationHash, bytes32 credentialHash, uint64 validUntil);
    event EvidenceLinked(bytes32 indexed orderId, bytes32 indexed evidenceId);
    event CorrectionAppended(bytes32 indexed correctionId, bytes32 indexed originalId, address indexed actor, bytes32 reasonHash, bytes32 valuesHash, uint64 occurredAt, uint64 recordedAt, bool reconciliationRequired);

    constructor(address stakeholder, address ingredient, address product, address evidenceRegistry, address custodyRegistry) {
        stakeholders = IStakeholderRegistry(stakeholder); ingredients = IngredientRegistry(ingredient);
        products = ProductRegistry(product); evidence = EvidenceRegistry(evidenceRegistry); custody = CustodyTransfer(custodyRegistry);
    }
    function registerLocation(bytes32 location, bytes32 detailsHash) external {
        if (stakeholders.roleOf(msg.sender) < 2) revert Unauthorized();
        if (location == bytes32(0) || detailsHash == bytes32(0) || locationOwner[location] != address(0)) revert InvalidInput();
        locationOwner[location] = msg.sender; locationDetailsHash[location] = detailsHash;
        emit LocationRegistered(location, msg.sender, detailsHash);
    }
    function listItem(bytes32 itemId, string calldata name, uint8 kind, bytes32 batchId, bytes32 metadataHash) external {
        if (itemId == bytes32(0) || bytes(name).length == 0 || bytes(name).length > 160 || metadataHash == bytes32(0)) revert InvalidInput();
        bytes32 unit;
        if (kind == 1) {
            IngredientRegistry.Batch memory batch = ingredients.getBatch(batchId);
            if (batch.supplier != msg.sender || !stakeholders.isAuthorized(msg.sender, 2) || !ingredients.isValidTraceabilitySource(batchId)) revert Unauthorized();
            unit = batch.unit;
        } else if (kind == 2) {
            ProductRegistry.Product memory batch = products.getProduct(batchId);
            if (batch.manufacturer != msg.sender || !stakeholders.isAuthorized(msg.sender, 3) || !products.isTransferable(batchId)) revert Unauthorized();
            unit = batch.unit;
        } else revert InvalidInput();
        if (unit == bytes32(0)) revert InvalidInput();
        Item storage item = items[itemId];
        if (item.seller != address(0) && (item.seller != msg.sender || item.kind != kind || item.unit != unit)) revert InvalidInput();
        if (batchItem[batchId] != bytes32(0) && batchItem[batchId] != itemId) revert InvalidState();
        items[itemId] = Item(msg.sender, kind, unit, metadataHash, name, true); batchItem[batchId] = itemId;
        emit ItemListed(itemId, msg.sender, batchId);
    }
    /// Discoverability follows registration; sellers do not need a separate publishing transaction.
    function requestBatch(bytes32 orderId, uint8 kind, bytes32 batchId, uint256 quantity, bytes32 receivingLocation,
        uint64 expiresAt, bool evidenceRequired, bytes32 detailsHash, string calldata detailsCid) external {
        bytes32 itemId = _registeredItem(kind, batchId);
        requestOrder(orderId, itemId, quantity, items[itemId].unit, receivingLocation, expiresAt, evidenceRequired, detailsHash, detailsCid);
    }
    /// An expression of supply interest. It cannot reserve, dispatch or credit inventory.
    function requestInterest(bytes32 requestId, uint8 kind, bytes32 batchId, uint256 quantity,
        uint64 expiresAt, bytes32 detailsHash, string calldata detailsCid) external {
        bytes32 itemId = _registeredItem(kind, batchId);
        _createRequest(requestId, itemId, quantity, items[itemId].unit, bytes32(0), expiresAt, false, detailsHash, detailsCid);
        requestOnly[requestId] = true;
    }
    function _registeredItem(uint8 kind, bytes32 batchId) private returns (bytes32 itemId) {
        if (kind == 1 && ingredients.getListing(batchId).archived) revert InvalidState();
        if ((kind == 1 && !ingredients.isValidTraceabilitySource(batchId)) || (kind == 2 && !products.isTransferable(batchId))) revert InvalidState();
        itemId = batchItem[batchId];
        if (itemId == bytes32(0)) {
            address seller; bytes32 unit; bytes32 metadataHash;
            if (kind == 1) {
                IngredientRegistry.Batch memory batch = ingredients.getBatch(batchId);
                if (!ingredients.isValidTraceabilitySource(batchId)) revert InvalidState();
                seller = batch.supplier; unit = batch.unit; metadataHash = batch.metadataHash;
            } else if (kind == 2) {
                ProductRegistry.Product memory batch = products.getProduct(batchId);
                if (!products.isTransferable(batchId)) revert InvalidState();
                seller = batch.manufacturer; unit = batch.unit; metadataHash = batch.metadataHash;
            } else revert InvalidInput();
            itemId = keccak256(abi.encodePacked('registered:', kind, batchId));
            items[itemId] = Item(seller, kind, unit, metadataHash, kind == 1 ? 'Registered ingredient' : 'Registered product', true);
            batchItem[batchId] = itemId;
            emit ItemListed(itemId, seller, batchId);
        }
        if (items[itemId].kind != kind) revert InvalidInput();
    }
    function requestOrder(bytes32 orderId, bytes32 itemId, uint256 quantity, bytes32 unit, bytes32 receivingLocation,
        uint64 expiresAt, bool evidenceRequired, bytes32 detailsHash, string calldata detailsCid) public {
        if (locationOwner[receivingLocation] != msg.sender) revert InvalidInput();
        _createRequest(orderId, itemId, quantity, unit, receivingLocation, expiresAt, evidenceRequired, detailsHash, detailsCid);
    }
    function _createRequest(bytes32 orderId, bytes32 itemId, uint256 quantity, bytes32 unit, bytes32 receivingLocation,
        uint64 expiresAt, bool evidenceRequired, bytes32 detailsHash, string calldata detailsCid) private {
        Item memory item = items[itemId];
        uint8 buyerRole = item.kind == 1 ? 3 : 5;
        if (!stakeholders.isAuthorized(msg.sender, buyerRole) || !stakeholders.isAuthorized(item.seller, item.kind == 1 ? 2 : 3)) revert Unauthorized();
        if (!item.active || orders[orderId].buyer != address(0) || orderId == bytes32(0) || quantity == 0 ||
            item.unit != unit || expiresAt <= block.timestamp || detailsHash == bytes32(0)) revert InvalidInput();
        Order storage order = orders[orderId];
        order.buyer = msg.sender; order.seller = item.seller; order.itemId = itemId; order.requested = quantity;
        order.receivingLocation = receivingLocation; order.expiresAt = expiresAt; order.status = 1;
        order.evidenceRequired = evidenceRequired; order.detailsHash = detailsHash; order.detailsCid = detailsCid;
        emit OrderRequested(orderId, msg.sender, item.seller);
    }
    function propose(bytes32 orderId, bytes32 batchId, bytes32 location) external {
        if (requestOnly[orderId]) revert InvalidState();
        Order storage order = _seller(orderId);
        if (batchItem[batchId] != order.itemId || locationOwner[location] != msg.sender || order.dispatched >= order.requested) revert InvalidState();
        _release(orderId, order);
        order.proposedBatch = batchId; order.dispatchLocation = location; order.status = 1;
        ++proposalEpoch[orderId];
        delete orderEvidence[orderId];
        emit BatchProposed(orderId, batchId, location, proposalEpoch[orderId]);
        emit OrderChanged(orderId, order.status);
    }
    function allocate(bytes32 orderId, uint256 quantity) external {
        if (requestOnly[orderId]) revert InvalidState();
        Order storage order = _seller(orderId);
        if (order.proposedBatch == bytes32(0) || order.allocated != order.dispatched || quantity == 0 || quantity > order.requested - order.dispatched) revert InvalidState();
        if (items[order.itemId].kind == 1) ingredients.reserveSupply(order.proposedBatch, quantity, false);
        else custody.reserveOrder(orderId, order.proposedBatch, order.seller, order.buyer, quantity);
        order.allocated += quantity; order.status = 2;
        emit OrderChanged(orderId, order.status);
    }
    function closeOrder(bytes32 orderId) external {
        Order storage order = orders[orderId];
        if (order.buyer == address(0) || order.status > 2 || order.status == 0) revert InvalidState();
        if (msg.sender != order.seller && msg.sender != order.buyer && block.timestamp <= order.expiresAt) revert Unauthorized();
        _release(orderId, order); order.status = 3;
        emit OrderChanged(orderId, 3);
    }
    function requestIdentity(bytes32 orderId, bytes32 challenge, bytes32 purposeHash, bytes32 claimsHash, uint64 expiresAt, bool required) external {
        Order storage order = _seller(orderId);
        if (challenge == bytes32(0) || purposeHash == bytes32(0) || claimsHash == bytes32(0) || expiresAt <= block.timestamp || expiresAt > order.expiresAt) revert InvalidInput();
        order.identityRequired = required; order.identityChallenge = challenge; order.identityCredentialHash = bytes32(0); order.identityValidUntil = 0;
        identityDeadline[orderId] = expiresAt;
        emit IdentityRequested(orderId, challenge, purposeHash, claimsHash, expiresAt, required);
    }
    function attestIdentity(bytes32 orderId, bytes32 challenge, bytes32 credentialHash, bytes32 presentationHash, uint64 validUntil) external {
        Order storage order = _seller(orderId);
        if (challenge == bytes32(0) || challenge != order.identityChallenge || credentialHash != stakeholders.credentialHashOf(order.buyer) ||
            presentationHash == bytes32(0) || order.identityCredentialHash != bytes32(0) || validUntil <= block.timestamp || validUntil > identityDeadline[orderId]) revert InvalidInput();
        order.identityCredentialHash = credentialHash; order.identityValidUntil = validUntil;
        emit IdentityAttested(orderId, presentationHash, credentialHash, validUntil);
    }
    function linkEvidence(bytes32 orderId, bytes32 evidenceId) external {
        Order storage order = orders[orderId];
        if (msg.sender != order.buyer || order.status == 0 || order.status > 2 || orderEvidence[orderId].length >= 50) revert Unauthorized();
        if (evidenceOrder[evidenceId] != orderId || evidenceEpoch[evidenceId] != proposalEpoch[orderId]) revert InvalidState();
        _checkEvidence(order, evidenceId);
        for (uint256 i; i < orderEvidence[orderId].length; ++i) if (orderEvidence[orderId][i] == evidenceId) revert InvalidState();
        orderEvidence[orderId].push(evidenceId); emit EvidenceLinked(orderId, evidenceId);
    }
    function bindEvidenceRequest(bytes32 orderId, bytes32 evidenceId) external {
        Order storage order = orders[orderId];
        EvidenceRegistry.Request memory proof = evidence.getRequest(evidenceId);
        if (order.buyer == msg.sender && evidenceOrder[evidenceId] == orderId && evidenceEpoch[evidenceId] == proposalEpoch[orderId]) return;
        if (order.buyer != msg.sender || order.status == 0 || order.status > 2 || order.expiresAt <= block.timestamp || proof.requester != msg.sender ||
            proof.status != EvidenceRegistry.RequestStatus.AwaitingResponse || evidenceOrder[evidenceId] != bytes32(0) || !_isProposedSource(order, proof.ingredientBatchId)) revert InvalidState();
        evidenceOrder[evidenceId] = orderId; evidenceEpoch[evidenceId] = proposalEpoch[orderId];
        emit EvidenceLinked(orderId, evidenceId);
    }
    function dispatch(bytes32 orderId, bytes32 shipmentId, uint256 quantity, uint64 occurredAt,
        address distributor, bytes32 transitLocation, uint64 expectedAt, bytes32 shipmentHash, string calldata encryptedCid) external {
        if (requestOnly[orderId]) revert InvalidState();
        Order storage order = _seller(orderId); Item memory item = items[order.itemId];
        if (quantity == 0 || quantity > order.allocated - order.dispatched || shipments[shipmentId].status != 0 || shipmentId == bytes32(0) ||
            occurredAt > block.timestamp || occurredAt == 0 || shipmentHash == bytes32(0)) revert InvalidInput();
        if (!stakeholders.isAuthorized(order.buyer, item.kind == 1 ? 3 : 5)) revert Unauthorized();
        if (order.identityRequired && (order.identityValidUntil <= block.timestamp || order.identityCredentialHash != stakeholders.credentialHashOf(order.buyer))) revert InvalidState();
        if (order.evidenceRequired && orderEvidence[orderId].length == 0) revert InvalidState();
        for (uint256 i; i < orderEvidence[orderId].length; ++i) _checkEvidence(order, orderEvidence[orderId][i]);
        address recipient = order.buyer; bytes32 destination = order.receivingLocation;
        if (item.kind == 1) {
            if (!ingredients.isValidTraceabilitySource(order.proposedBatch)) revert InvalidState();
        } else {
            // Preserve manufacturer -> distributor -> retailer. No direct route is added.
            if (!stakeholders.isAuthorized(distributor, 4) || locationOwner[transitLocation] != distributor) revert Unauthorized();
            recipient = distributor; destination = transitLocation;
            custody.dispatchOrder(orderId, shipmentId, order.proposedBatch, order.seller, distributor, quantity, expectedAt, shipmentHash, encryptedCid);
            custody.recordOrderLocations(shipmentId, order.dispatchLocation, transitLocation, occurredAt);
        }
        order.dispatched += quantity;
        shipments[shipmentId] = Shipment(orderId, order.proposedBatch, msg.sender, recipient, quantity, order.dispatchLocation, destination,
            occurredAt, uint64(block.timestamp), 1, 0, 0, 0, 0, 0, 0);
        orderShipments[orderId].push(shipmentId);
        emit ShipmentDispatched(shipmentId, orderId, order.proposedBatch);
    }
    function receiveIngredient(bytes32 shipmentId, uint256 accepted, uint256 damaged, uint256 rejected, uint256 missing, uint64 occurredAt) external {
        Shipment storage shipment = shipments[shipmentId];
        Order storage order = orders[shipment.orderId];
        if (msg.sender != shipment.recipient || !stakeholders.isAuthorized(msg.sender, 3) || items[order.itemId].kind != 1) revert Unauthorized();
        if (shipment.status != 1 || accepted + damaged + rejected + missing != shipment.quantity || occurredAt < shipment.occurredAt || occurredAt > block.timestamp) revert InvalidState();
        shipment.status = 2; shipment.accepted = accepted; shipment.damaged = damaged; shipment.rejected = rejected; shipment.missing = missing;
        shipment.receivedAt = occurredAt; shipment.receiptRecordedAt = uint64(block.timestamp);
        ingredients.receiveSupply(shipment.batchId, msg.sender, shipment.toLocation, accepted, damaged, rejected, missing);
        emit ShipmentReceived(shipmentId, accepted, damaged, rejected, missing, occurredAt, uint64(block.timestamp));
    }
    function appendCorrection(bytes32 correctionId, bytes32 shipmentId, bytes32 reasonHash, bytes32 valuesHash, uint64 occurredAt,
        bool reduceStock, uint256 correctedUsable) external {
        Shipment memory shipment = shipments[shipmentId];
        if (shipment.status == 0 || !stakeholders.isAuthorized(msg.sender, 1)) revert Unauthorized();
        if (correctionId == bytes32(0) || correctionUsed[correctionId] || reasonHash == bytes32(0) || valuesHash == bytes32(0) || occurredAt == 0 || occurredAt > block.timestamp) revert InvalidInput();
        correctionUsed[correctionId] = true;
        bool reconcile = true;
        if (reduceStock) {
            if (items[orders[shipment.orderId].itemId].kind != 1 || shipment.status != 2) revert InvalidState();
            IngredientRegistry.ReceivedStock memory stock = ingredients.getReceivedStock(shipment.batchId, shipment.recipient, shipment.toLocation);
            ingredients.correctReceived(shipment.batchId, shipment.recipient, shipment.toLocation, correctedUsable);
            reconcile = stock.consumed > 0;
        }
        emit CorrectionAppended(correctionId, shipmentId, msg.sender, reasonHash, valuesHash, occurredAt, uint64(block.timestamp), reconcile);
    }
    function getItem(bytes32 itemId) external view returns (Item memory) { return items[itemId]; }
    function getOrder(bytes32 orderId) external view returns (Order memory) { return orders[orderId]; }
    function getShipment(bytes32 shipmentId) external view returns (Shipment memory) { return shipments[shipmentId]; }
    function getOrderShipments(bytes32 orderId) external view returns (bytes32[] memory) { return orderShipments[orderId]; }
    function getOrderEvidence(bytes32 orderId) external view returns (bytes32[] memory) { return orderEvidence[orderId]; }
    function _seller(bytes32 orderId) private view returns (Order storage order) {
        order = orders[orderId];
        if (order.seller != msg.sender || !stakeholders.isAuthorized(msg.sender, items[order.itemId].kind == 1 ? 2 : 3)) revert Unauthorized();
        if (!stakeholders.hasPermission(msg.sender, items[order.itemId].kind == 1 ? keccak256('REGISTER_INGREDIENT') : keccak256('INITIATE_TRANSFER'))) revert Unauthorized();
        if (order.status == 0 || order.status > 2 || order.expiresAt <= block.timestamp) revert InvalidState();
    }
    function _release(bytes32 orderId, Order storage order) private {
        uint256 remaining = order.allocated - order.dispatched;
        if (remaining != 0) {
            if (items[order.itemId].kind == 1) ingredients.reserveSupply(order.proposedBatch, remaining, true);
            else custody.releaseOrder(orderId, order.proposedBatch, order.seller, remaining);
        }
        order.allocated = order.dispatched;
    }
    function _checkEvidence(Order storage order, bytes32 evidenceId) private view {
        EvidenceRegistry.Request memory proof = evidence.getRequest(evidenceId);
        if (proof.requester != order.buyer || proof.status != EvidenceRegistry.RequestStatus.Accepted || proof.presentationExpiresAt <= block.timestamp) revert InvalidState();
        if (!_isProposedSource(order, proof.ingredientBatchId)) revert InvalidState();
        if (items[order.itemId].kind == 1) {
            if (proof.ingredientBatchId != order.proposedBatch || proof.supplier != order.seller) revert InvalidState();
        } else {
            ProductRegistry.IngredientLink[] memory links = products.getIngredientLinks(order.proposedBatch);
            bool linked;
            for (uint256 i; i < links.length; ++i) if (links[i].batchId == proof.ingredientBatchId) linked = true;
            if (!linked) revert InvalidState();
        }
        if (!ingredients.isValidTraceabilitySource(proof.ingredientBatchId)) revert InvalidState();
    }
    function _isProposedSource(Order storage order, bytes32 ingredientBatchId) private view returns (bool) {
        if (items[order.itemId].kind == 1) return order.proposedBatch == ingredientBatchId;
        ProductRegistry.IngredientLink[] memory links = products.getIngredientLinks(order.proposedBatch);
        for (uint256 i; i < links.length; ++i) if (links[i].batchId == ingredientBatchId) return true;
        return false;
    }
}
