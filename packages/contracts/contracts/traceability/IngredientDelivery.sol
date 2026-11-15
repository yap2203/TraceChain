// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IngredientRegistry} from './IngredientRegistry.sol';
import {ProductRegistry} from './ProductRegistry.sol';
import {EvidenceRegistry} from './EvidenceRegistry.sol';

interface IIngredientDeliveryOrders {
    function locationOwner(bytes32 location) external view returns (address);
    function requestDecision(bytes32 orderId) external view returns (uint8, bytes32, string memory, uint64);
    function requestIngredientDelivery(bytes32, bytes32, uint256, uint64, bytes32, string calldata) external;
    function settleCustodyStock(bytes32, bytes32, address, bytes32, uint256) external;
    function deliveryOrderContext(bytes32 orderId) external view returns (address, address, bytes32, uint256, uint64, uint8);
    function reserveDeliveryStock(bytes32 orderId, uint256 quantity) external;
    function finalizeExpiredDelivery(bytes32 orderId) external;
}

/// Per-order custody stage, deployed and controlled by SupplyChainOrders, never a public relay.
contract IngredientDelivery {
    address public pendingBuyer;
    function reviewPolicy() external pure returns (uint8) { return 1; }
    function fulfilmentPolicy() external pure returns (uint8) { return 2; }
    mapping(bytes32 => uint8) public warehouseDecision;
    mapping(bytes32 => bool) public deliveryArranged;
    mapping(bytes32 => uint64) private arrangedAt;
    event WarehouseDecision(bytes32 indexed shipmentId, address indexed distributor, uint8 decision);
    event DeliveryArranged(bytes32 indexed orderId, address indexed supplier);
    /// Supplier chooses received warehouse stock only after approving the buyer's request.
    function arrangeFromCustody(bytes32 orderId, bytes32 positionId, bytes32 receivingLocation) external {
        Context memory c = context(orderId);
        _role(msg.sender, 2, 'REGISTER_INGREDIENT');
        (uint8 decision,,,) = orders.requestDecision(orderId);
        Record storage r = records[orderId];
        if (msg.sender != c.seller || get(orderId).stage != 1 || c.status != 1 || decision != 1 || custodyOrders[orderId].quantity != 0 || deliveryArranged[orderId] || orders.locationOwner(receivingLocation) != c.buyer) revert InvalidState();
        _prune(positionId);
        (Position memory position,,uint256 available) = getPosition(positionId);
        if (position.supplier != msg.sender || position.batchId != c.batchId || c.quantity > available) revert InvalidState();
        _source(c.batchId, msg.sender); _role(position.distributor, 4, 'RECEIVE_TRANSFER');
        custodyOrders[orderId] = CustodyOrder(positionId, receivingLocation, c.quantity, 0, 0);
        positionOrders[positionId].push(orderId);
        r.distributor = position.distributor; r.stage = 3; r.assignmentDeadline = 0;
        deliveryArranged[orderId] = true; arrangedAt[orderId] = uint64(block.timestamp);
        emit DeliveryArranged(orderId, msg.sender);
        emit IngredientDeliveryChanged(orderId, position.distributor, 3, uint64(block.timestamp));
    }
    function arrangeDelivery(bytes32 orderId) external {
        Context memory c = context(orderId);
        _role(msg.sender, 2, 'REGISTER_INGREDIENT');
        (uint8 decision,,,) = orders.requestDecision(orderId);
        if (msg.sender != c.seller || custodyOrders[orderId].quantity == 0 || c.status != 1 || c.expiresAt <= block.timestamp || decision != 1 || deliveryArranged[orderId]) revert InvalidState();
        deliveryArranged[orderId] = true;
        arrangedAt[orderId] = uint64(block.timestamp);
        emit DeliveryArranged(orderId, msg.sender);
    }
    function _proofCurrent(bytes32 referenceId, address supplier) private view {
        Record storage r = records[referenceId];
        if (r.identityChallenge != bytes32(0) && (r.identityValidUntil <= block.timestamp || r.identityCredentialHash != stakeholders.credentialHashOf(supplier))) revert InvalidState();
    }
    function decideWarehouseShipment(bytes32 shipmentId, uint8 decision) external {
        RoadShipment storage shipment = roadShipments[shipmentId];
        _role(msg.sender, 4, 'RECEIVE_TRANSFER');
        if (shipment.leg != 1 || shipment.recipient != msg.sender || shipment.status != 1 || shipment.received != 0 || warehouseDecision[shipmentId] != 0 || (decision != 1 && decision != 2)) revert InvalidState();
        warehouseDecision[shipmentId] = decision;
        if (decision == 1) { _source(shipment.batchId, shipment.sender); _proofCurrent(shipmentId, shipment.sender); records[shipmentId].stage = 3; }
        else {
            shipment.status = 4; records[shipmentId].stage = 6;
        }
        emit WarehouseDecision(shipmentId, msg.sender, decision);
    }
    function confirmRejectedReturn(bytes32 receiptId, bytes32 shipmentId, uint64 occurredAt) external {
        RoadShipment storage shipment = roadShipments[shipmentId];
        _role(msg.sender, 2, 'REGISTER_INGREDIENT');
        if (shipment.leg != 1 || shipment.sender != msg.sender || shipment.status != 4 || receiptId == bytes32(0) || receiptUsed[receiptId] || occurredAt < shipment.dispatchedAt || occurredAt > block.timestamp) revert InvalidState();
        receiptUsed[receiptId] = true; shipment.status = 5;
        orders.settleCustodyStock(bytes32(0), shipment.batchId, shipment.sender, bytes32(0), shipment.quantity);
        emit RoadShipmentReceived(shipmentId, receiptId, shipment.quantity, occurredAt, uint64(block.timestamp));
    }
    function custodyPolicy() external pure returns (uint8) { return 1; }
    struct Warehouse { address distributor; string name; }
    struct Position { bytes32 batchId; address supplier; address distributor; bytes32 location; bytes32 unit; uint256 quantity; }
    struct CustodyOrder { bytes32 positionId; bytes32 receivingLocation; uint256 quantity; uint256 dispatched; uint256 received; }
    struct RoadShipment {
        bytes32 orderId; bytes32 batchId; bytes32 positionId; address sender; address recipient;
        uint256 quantity; uint256 received; bytes32 unit; bytes32 fromLocation; bytes32 toLocation;
        string vehicle; uint64 dispatchedAt; uint64 expectedAt; uint64 recordedAt; uint64 receivedAt;
        address confirmedBy; uint8 leg; uint8 status;
    }
    struct RoadInput { bytes32 shipmentId; bytes32 referenceId; uint256 quantity; bytes32 fromLocation; bytes32 toLocation; string vehicle; uint64 occurredAt; uint64 expectedAt; }
    mapping(bytes32 => Warehouse) public warehouses;
    mapping(bytes32 => Position) private positions;
    mapping(bytes32 => CustodyOrder) public custodyOrders;
    mapping(bytes32 => bytes32[]) private positionOrders;
    mapping(bytes32 => RoadShipment) private roadShipments;
    mapping(bytes32 => bool) private receiptUsed;
    event WarehouseRegistered(bytes32 indexed location, address indexed distributor, string name);
    event CustodyPositionCreated(bytes32 indexed positionId, bytes32 indexed batchId, address indexed distributor);
    event RoadShipmentDispatched(bytes32 indexed shipmentId, bytes32 indexed orderId, uint8 leg);
    event RoadShipmentReceived(bytes32 indexed shipmentId, bytes32 indexed receiptId, uint256 quantity, uint64 occurredAt, uint64 recordedAt);
    event CustodyOrderPlaced(bytes32 indexed orderId, bytes32 indexed positionId, address indexed manufacturer, uint256 quantity);
    function registerWarehouse(bytes32 location, string calldata name) external {
        _role(msg.sender, 4, 'RECEIVE_TRANSFER');
        if (location == bytes32(0) || orders.locationOwner(location) != msg.sender || warehouses[location].distributor != address(0) || bytes(name).length == 0 || bytes(name).length > 160) revert InvalidState();
        warehouses[location] = Warehouse(msg.sender, name); emit WarehouseRegistered(location, msg.sender, name);
    }
    function _role(address actor, uint8 role, string memory permission) private view {
        if (!stakeholders.isAuthorized(actor, role) || !stakeholders.hasPermission(actor, keccak256(bytes(permission)))) revert Unauthorized();
    }
    function _source(bytes32 batchId, address supplier) private view {
        if (!stakeholders.isAuthorized(supplier, 2) || ingredients.getBatch(batchId).supplier != supplier || !ingredients.isValidTraceabilitySource(batchId)) revert InvalidState();
    }
    function _checkVehicle(string memory vehicle) private pure {
        if (bytes(vehicle).length < 2 || bytes(vehicle).length > 32) revert InvalidState();
        bool meaningful;
        for (uint256 i; i < bytes(vehicle).length; ++i) {
            bytes1 c = bytes(vehicle)[i];
            if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || c == 0x20 || c == 0x2d)) revert InvalidState();
            if (c != 0x20 && c != 0x2d) meaningful = true;
        }
        if (!meaningful) revert InvalidState();
    }
    function _road(RoadInput calldata input) private view {
        (,,,,,uint8 existingOrder) = orders.deliveryOrderContext(input.shipmentId);
        if (existingOrder != 0) revert InvalidState();
        if (input.shipmentId == bytes32(0) || roadShipments[input.shipmentId].status != 0 || input.quantity == 0 || input.occurredAt == 0 || input.occurredAt > block.timestamp || input.expectedAt <= input.occurredAt) revert InvalidState();
        if (bytes(input.vehicle).length > 0) _checkVehicle(input.vehicle);
    }
    function dispatchToWarehouse(RoadInput calldata input) external {
        _role(msg.sender, 2, 'REGISTER_INGREDIENT'); _road(input);
        Warehouse memory warehouse = warehouses[input.toLocation];
        if (warehouse.distributor == address(0) || orders.locationOwner(input.fromLocation) != msg.sender) revert Unauthorized();
        _role(warehouse.distributor, 4, 'RECEIVE_TRANSFER'); _source(input.referenceId, msg.sender);
        IngredientRegistry.Batch memory batch = ingredients.getBatch(input.referenceId);
        if (input.occurredAt < batch.producedAt) revert InvalidState();
        orders.settleCustodyStock(bytes32(0), input.referenceId, address(0), bytes32(0), input.quantity);
        bytes32 positionId = keccak256(abi.encode(input.referenceId, warehouse.distributor, input.toLocation));
        if (positions[positionId].supplier == address(0)) {
            positions[positionId] = Position(input.referenceId, msg.sender, warehouse.distributor, input.toLocation, batch.unit, 0);
            emit CustodyPositionCreated(positionId, input.referenceId, warehouse.distributor);
        }
        roadShipments[input.shipmentId] = RoadShipment(bytes32(0), input.referenceId, positionId, msg.sender, warehouse.distributor, input.quantity, 0, batch.unit, input.fromLocation, input.toLocation, input.vehicle, input.occurredAt, input.expectedAt, uint64(block.timestamp), 0, msg.sender, 1, 1);
        records[input.shipmentId].distributor = warehouse.distributor;
        records[input.shipmentId].stage = 2;
        emit RoadShipmentDispatched(input.shipmentId, bytes32(0), 1);
    }
    function getPosition(bytes32 positionId) public view returns (Position memory position, uint256 reserved, uint256 available) {
        position = positions[positionId];
        for (uint256 i; i < positionOrders[positionId].length; ++i) {
            bytes32 orderId = positionOrders[positionId][i]; Context memory c = context(orderId);
            if (c.status < 3 && c.expiresAt > block.timestamp) reserved += custodyOrders[orderId].quantity - custodyOrders[orderId].dispatched;
        }
        available = position.quantity - reserved;
    }
    function _prune(bytes32 positionId) private {
        bytes32[] storage pending = positionOrders[positionId]; uint256 i;
        while (i < pending.length) {
            Context memory c = context(pending[i]); CustodyOrder memory order = custodyOrders[pending[i]];
            if (c.status >= 3 || c.expiresAt <= block.timestamp || order.quantity == order.dispatched) { pending[i] = pending[pending.length - 1]; pending.pop(); }
            else ++i;
        }
        if (pending.length >= 128) revert InvalidState();
    }
    function placeCustodyOrder(bytes32 orderId, bytes32 positionId, uint256 quantity, bytes32 receivingLocation, uint64 expiresAt, bytes32 detailsHash, string calldata cid) external {
        if (roadShipments[orderId].status != 0) revert InvalidState();
        _role(msg.sender, 3, 'REQUEST_EVIDENCE');
        _prune(positionId);
        (Position memory position,,uint256 available) = getPosition(positionId);
        if (quantity == 0 || quantity > available || custodyOrders[orderId].quantity != 0 || orders.locationOwner(receivingLocation) != msg.sender) revert InvalidState();
        _source(position.batchId, position.supplier); _role(position.distributor, 4, 'RECEIVE_TRANSFER');
        pendingBuyer = msg.sender;
        orders.requestIngredientDelivery(orderId, position.batchId, quantity, expiresAt, detailsHash, cid);
        pendingBuyer = address(0);
        custodyOrders[orderId] = CustodyOrder(positionId, receivingLocation, quantity, 0, 0); positionOrders[positionId].push(orderId);
        emit CustodyOrderPlaced(orderId, positionId, msg.sender, quantity);
    }
    function dispatchCustodyOrder(RoadInput calldata input) external {
        _road(input); _checkVehicle(input.vehicle); CustodyOrder storage order = custodyOrders[input.referenceId]; Position storage position = positions[order.positionId]; Context memory c = context(input.referenceId);
        if (!deliveryArranged[input.referenceId] || input.occurredAt < arrangedAt[input.referenceId]) revert InvalidState();
        _role(msg.sender, 4, 'RECEIVE_TRANSFER'); _source(position.batchId, position.supplier);
        (uint8 decision,,,uint64 approvedAt) = orders.requestDecision(input.referenceId);
        if (position.distributor != msg.sender || input.fromLocation != position.location || input.toLocation != order.receivingLocation || decision != 1 || input.occurredAt < approvedAt || c.status != 1 || c.expiresAt <= block.timestamp || input.quantity > order.quantity - order.dispatched) revert InvalidState();
        _role(c.buyer, 3, 'REGISTER_PRODUCT');
        Record storage r = records[input.referenceId];
        if (r.identityChallenge != bytes32(0) && (r.identityValidUntil <= block.timestamp || r.identityCredentialHash != stakeholders.credentialHashOf(position.supplier))) revert InvalidState();
        position.quantity -= input.quantity; order.dispatched += input.quantity;
        r.stage = 4; r.pickedUpAt = input.occurredAt; r.reservedQuantity += input.quantity;
        roadShipments[input.shipmentId] = RoadShipment(input.referenceId, position.batchId, order.positionId, msg.sender, c.buyer, input.quantity, 0, position.unit, position.location, order.receivingLocation, input.vehicle, input.occurredAt, input.expectedAt, uint64(block.timestamp), 0, msg.sender, 2, 1);
        emit RoadShipmentDispatched(input.shipmentId, input.referenceId, 2);
    }
    function getRoadShipment(bytes32 shipmentId) external view returns (RoadShipment memory) { return roadShipments[shipmentId]; }
    function receiveRoadShipment(bytes32 receiptId, bytes32 shipmentId, uint256 quantity, uint64 occurredAt) external {
        receiveRoadShipmentWithVehicle(receiptId, shipmentId, quantity, occurredAt, "");
    }
    function receiveRoadShipmentWithVehicle(bytes32 receiptId, bytes32 shipmentId, uint256 quantity, uint64 occurredAt, string memory vehicle) public {
        RoadShipment storage shipment = roadShipments[shipmentId]; Position storage position = positions[shipment.positionId];
        if (shipment.recipient != msg.sender || shipment.status == 0 || shipment.status >= 3 || receiptId == bytes32(0) || receiptUsed[receiptId] || quantity == 0 || quantity > shipment.quantity - shipment.received || occurredAt < shipment.dispatchedAt || occurredAt > block.timestamp) revert InvalidState();
        if (shipment.leg == 1) { if (warehouseDecision[shipmentId] != 1) revert InvalidState(); _proofCurrent(shipmentId, shipment.sender); }
        _role(msg.sender, shipment.leg == 1 ? 4 : 3, shipment.leg == 1 ? 'RECEIVE_TRANSFER' : 'REGISTER_PRODUCT'); _source(shipment.batchId, position.supplier);
        if (bytes(vehicle).length > 0) {
            _checkVehicle(vehicle);
            shipment.vehicle = vehicle;
        }
        receiptUsed[receiptId] = true; shipment.received += quantity; shipment.receivedAt = occurredAt; shipment.status = shipment.received == shipment.quantity ? 3 : 2;
        if (shipment.leg == 1) { position.quantity += quantity; if (shipment.status == 3) records[shipmentId].stage = 5; }
        else {
            custodyOrders[shipment.orderId].received += quantity;
            records[shipment.orderId].reservedQuantity -= quantity;
            orders.settleCustodyStock(shipment.orderId, shipment.batchId, msg.sender, shipment.toLocation, quantity);
            if (custodyOrders[shipment.orderId].received == custodyOrders[shipment.orderId].quantity) { records[shipment.orderId].stage = 5; records[shipment.orderId].deliveredAt = occurredAt; }
        }
        emit RoadShipmentReceived(shipmentId, receiptId, quantity, occurredAt, uint64(block.timestamp));
    }
    function setShipmentVehicle(bytes32 shipmentId, string calldata vehicle) external {
        RoadShipment storage shipment = roadShipments[shipmentId];
        _role(msg.sender, 4, 'RECEIVE_TRANSFER');
        if (shipment.status == 0 || shipment.status == 4) revert InvalidState();
        if (shipment.recipient != msg.sender && shipment.sender != msg.sender) revert Unauthorized();
        _checkVehicle(vehicle);
        shipment.vehicle = vehicle;
    }
    struct Record {
        address distributor; uint64 assignmentDeadline; uint8 stage;
        uint64 acceptedAt; uint64 pickedUpAt; uint64 deliveredAt;
        bytes32 identityChallenge; bytes32 identityCredentialHash; uint64 identityValidUntil;
        uint256 reservedQuantity;
    }
    struct Context { address seller; address buyer; bytes32 batchId; uint256 quantity; uint64 expiresAt; uint8 status; }
    error Unauthorized(); error InvalidState();
    IIngredientDeliveryOrders public immutable orders;
    IStakeholderRegistry private immutable stakeholders;
    IngredientRegistry private immutable ingredients;
    ProductRegistry private immutable products;
    EvidenceRegistry private immutable evidence;
    mapping(bytes32 => Record) private records;
    event IngredientDeliveryChanged(bytes32 indexed orderId, address indexed distributor, uint8 stage, uint64 recordedAt);
    event DeliveryIdentityRequested(bytes32 indexed orderId, bytes32 challenge, uint64 expiresAt);
    event DeliveryIdentityAttested(bytes32 indexed orderId, bytes32 presentationHash, bytes32 credentialHash, uint64 validUntil);
    modifier onlyOrders() { if (msg.sender != address(orders)) revert Unauthorized(); _; }
    constructor(address parent, address registry, address ingredient, address product, address proofRegistry) {
        orders = IIngredientDeliveryOrders(parent); stakeholders = IStakeholderRegistry(registry); ingredients = IngredientRegistry(ingredient);
        products = ProductRegistry(product); evidence = EvidenceRegistry(proofRegistry);
    }
    function context(bytes32 orderId) private view returns (Context memory c) {
        RoadShipment storage shipment = roadShipments[orderId];
        if (shipment.leg == 1) return Context(shipment.sender, shipment.recipient, shipment.batchId, shipment.quantity, ingredients.getBatch(shipment.batchId).expiresAt, shipment.status >= 3 ? 3 : 1);
        (c.seller,c.buyer,c.batchId,c.quantity,c.expiresAt,c.status) = orders.deliveryOrderContext(orderId);
    }
    function get(bytes32 orderId) public view returns (Record memory result) {
        result = records[orderId]; Context memory c = context(orderId);
        if ((result.stage == 1 && block.timestamp >= result.assignmentDeadline) ||
            (result.stage > 0 && result.stage < 4 && (block.timestamp >= c.expiresAt || c.status == 3))) result.stage = 6;
    }
    function stageOf(bytes32 orderId) external view returns (uint8) { return get(orderId).stage; }
    function start(bytes32 orderId) external onlyOrders {
        if (records[orderId].stage != 0) revert InvalidState();
        Context memory c = context(orderId);
        if (!stakeholders.isAuthorized(c.seller, 2) || c.batchId == bytes32(0) || ingredients.getBatch(c.batchId).supplier != c.seller) revert InvalidState();
        if (custodyOrders[orderId].quantity != 0) {
            records[orderId].distributor = positions[custodyOrders[orderId].positionId].distributor;
            records[orderId].stage = 3;
            emit IngredientDeliveryChanged(orderId, records[orderId].distributor, 3, uint64(block.timestamp));
            return;
        }
        uint64 deadline = uint64(block.timestamp) + 48 hours;
        records[orderId].assignmentDeadline = deadline < c.expiresAt ? deadline : c.expiresAt;
        records[orderId].stage = 1;
        emit IngredientDeliveryChanged(orderId, address(0), 1, uint64(block.timestamp));
    }
    /// 1 assign, 2 accept, 3 decline, 4 request proof, 5 attest proof, 6 pickup, 7 finalize expiry.
    function act(uint8 action, address actor, bytes32 orderId, address distributor, bytes32 challenge,
        uint64 occurredAt, bytes32 credentialHash, bytes32 presentationHash, uint64 validUntil) external {
        if (actor != msg.sender) revert Unauthorized();
        if (roadShipments[orderId].leg == 1 && action != 4 && action != 5) revert InvalidState();
        if (custodyOrders[orderId].quantity != 0 && action != 4 && action != 5) revert InvalidState();
        Record storage r = records[orderId]; Context memory c = context(orderId); uint8 stage = get(orderId).stage;
        if (action == 7) {
            if (stage != 6 || r.stage == 6) revert InvalidState();
            r.stage = 6; orders.finalizeExpiredDelivery(orderId);
        } else if (action == 1) {
            if (actor != c.seller || !stakeholders.isAuthorized(actor, 2) || !stakeholders.hasPermission(actor, keccak256('REGISTER_INGREDIENT')) || !stakeholders.isAuthorized(distributor, 4) || !stakeholders.isAuthorized(c.buyer, 3)) revert Unauthorized();
            if (stage != 1) revert InvalidState();
            r.distributor = distributor; r.stage = 2;
            delete r.identityChallenge; delete r.identityCredentialHash; delete r.identityValidUntil;
        } else {
            if (actor != r.distributor || !stakeholders.isAuthorized(actor, 4) || !stakeholders.hasPermission(actor, keccak256('RECEIVE_TRANSFER'))) revert Unauthorized();
            if (action == 2 || action == 3) {
                if (stage != 2 && !(action == 3 && stage == 3)) revert InvalidState();
                r.stage = action == 2 ? 3 : 1; r.acceptedAt = action == 2 ? uint64(block.timestamp) : 0;
                if (action == 3) { r.distributor = address(0); delete r.identityChallenge; delete r.identityCredentialHash; delete r.identityValidUntil; }
            } else if (action == 4) {
                if ((stage != 2 && stage != 3) || challenge == bytes32(0) || validUntil <= block.timestamp || validUntil > c.expiresAt || r.identityValidUntil > block.timestamp) revert InvalidState();
                r.identityChallenge = challenge; r.identityCredentialHash = bytes32(0); r.identityValidUntil = validUntil;
                emit DeliveryIdentityRequested(orderId, challenge, validUntil);
            } else if (action == 5) {
                if ((stage != 2 && stage != 3) || challenge == bytes32(0) || challenge != r.identityChallenge || r.identityCredentialHash != bytes32(0) || credentialHash != stakeholders.credentialHashOf(c.seller) || presentationHash == bytes32(0) || validUntil <= block.timestamp || validUntil > r.identityValidUntil) revert InvalidState();
                r.identityCredentialHash = credentialHash; r.identityValidUntil = validUntil;
                emit DeliveryIdentityAttested(orderId, presentationHash, credentialHash, validUntil);
            } else if (action == 6) {
                if (!stakeholders.isAuthorized(c.seller, 2) || !stakeholders.isAuthorized(c.buyer, 3)) revert Unauthorized();
                if (stage != 3 || occurredAt < r.acceptedAt || occurredAt > block.timestamp ||
                    (r.identityChallenge != bytes32(0) && (r.identityValidUntil <= block.timestamp || r.identityCredentialHash != stakeholders.credentialHashOf(c.seller)))) revert InvalidState();
                orders.reserveDeliveryStock(orderId, c.quantity); r.reservedQuantity = c.quantity;
                r.stage = 4; r.pickedUpAt = occurredAt;
            } else revert InvalidState();
        }
        emit IngredientDeliveryChanged(orderId, r.distributor, r.stage, uint64(block.timestamp));
    }
    function consume(bytes32 orderId, uint256 quantity, uint64 occurredAt) external onlyOrders {
        if (custodyOrders[orderId].quantity != 0) revert InvalidState();
        Record storage r = records[orderId]; Context memory c = context(orderId);
        if (r.stage != 4 || quantity == 0 || quantity > r.reservedQuantity || occurredAt < r.pickedUpAt ||
            !stakeholders.isAuthorized(r.distributor, 4) || !stakeholders.isAuthorized(c.seller, 2) || !ingredients.isValidTraceabilitySource(c.batchId)) revert InvalidState();
        r.reservedQuantity -= quantity;
        if (r.reservedQuantity == 0) {
            r.stage = 5; r.deliveredAt = occurredAt;
            emit IngredientDeliveryChanged(orderId, r.distributor, 5, uint64(block.timestamp));
        }
    }
    function isProposedSource(uint8 kind, bytes32 batchId, bytes32 sourceBatch) public view returns (bool) {
        if (kind == 1) return batchId == sourceBatch;
        ProductRegistry.IngredientLink[] memory links = products.getIngredientLinks(batchId);
        for (uint256 i; i < links.length; ++i) if (links[i].batchId == sourceBatch) return true;
        return false;
    }
    function source(uint8 kind, bytes32 batchId) external view returns (address owner, bytes32 unit, bytes32 metadataHash) {
        if (kind == 1) {
            IngredientRegistry.Batch memory batch = ingredients.getBatch(batchId);
            if (!ingredients.isValidTraceabilitySource(batchId)) revert InvalidState();
            return (batch.supplier, batch.unit, batch.metadataHash);
        }
        if (kind == 2) {
            ProductRegistry.Product memory product = products.getProduct(batchId);
            if (!products.isTransferable(batchId)) revert InvalidState();
            return (product.manufacturer, product.unit, product.metadataHash);
        }
        revert InvalidState();
    }
    function checkEvidence(address buyer, address seller, uint8 kind, bytes32 batchId, bytes32 evidenceId) external view {
        EvidenceRegistry.Request memory proof = evidence.getRequest(evidenceId);
        if (proof.requester != buyer || proof.status != EvidenceRegistry.RequestStatus.Accepted || proof.presentationExpiresAt <= block.timestamp ||
            !isProposedSource(kind, batchId, proof.ingredientBatchId) || !ingredients.isValidTraceabilitySource(proof.ingredientBatchId) ||
            (kind == 1 && (proof.ingredientBatchId != batchId || proof.supplier != seller))) revert InvalidState();
    }
}
