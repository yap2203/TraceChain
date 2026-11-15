// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IProductRegistry} from '../interfaces/IProductRegistry.sol';
import {ProductRegistry} from './ProductRegistry.sol';
import {ProductDelivery} from './ProductDelivery.sol';
interface IOrderLocations { function locationOwner(bytes32) external view returns (address); }

contract CustodyTransfer {
    ProductDelivery public immutable productDelivery;
    mapping(bytes32=>bytes32) public productDeliveryOrder;
    mapping(bytes32=>address) public productDeliveryCarrier;
    function productDeliveryPolicy() external pure returns(uint8){return 1;}
    function reserveProductDelivery(bytes32 batchId,address holder,bytes32 location,uint256 quantity) external {
        if(msg.sender!=address(productDelivery))revert Unauthorized(msg.sender);
        _initialize(batchId);
        if(!locationTracked[batchId][holder]){
            if(products.manufacturerOf(batchId)!=holder||ProductRegistry(address(products)).productionLocation(batchId)!=location)revert InvalidState();
            locationTracked[batchId][holder]=true;locationStock[batchId][holder][location]=inventory[batchId][holder].available;
        }
        Inventory storage stock=inventory[batchId][holder];
        if(quantity==0||stock.available<quantity||locationStock[batchId][holder][location]<quantity)revert InsufficientInventory();
        stock.available-=quantity;stock.reserved+=quantity;locationStock[batchId][holder][location]-=quantity;
    }
    function releaseProductDelivery(bytes32 batchId,address holder,bytes32 location,uint256 quantity) external {
        if(msg.sender!=address(productDelivery))revert Unauthorized(msg.sender);
        Inventory storage stock=inventory[batchId][holder];stock.reserved-=quantity;stock.available+=quantity;locationStock[batchId][holder][location]+=quantity;
    }
    function dispatchProductDelivery(bytes32 orderId,ProductDelivery.Route calldata r,ProductDelivery.Transport calldata input) external {
        if(msg.sender!=address(productDelivery))revert Unauthorized(msg.sender);
        if(bytes(input.vehicle).length<2||bytes(input.vehicle).length>32)revert InvalidInput();
        Inventory storage stock=inventory[r.batchId][r.holder];stock.reserved-=r.quantity;stock.available+=r.quantity;
        productDeliveryOrder[input.transferId]=orderId;productDeliveryCarrier[input.transferId]=r.distributor;
        _createTransfer(r.holder,input.transferId,r.batchId,r.retailer,r.quantity,input.expectedAt,input.detailsHash,input.cid,true);
        _recordLocations(input.transferId,r.fromLocation,r.toLocation,input.occurredAt);
        vehicleRegistration[input.transferId]=input.vehicle;dispatchConfirmedBy[input.transferId]=r.distributor;
        transferOrder[input.transferId]=orderId;emit OrderTransferLinked(input.transferId,orderId);
        emit RoadTransportRecorded(input.transferId,r.fromLocation,r.toLocation,input.vehicle,input.occurredAt,uint64(block.timestamp),r.distributor);
    }
    function transportPolicy() external pure returns (uint8) { return 1; }
    mapping(bytes32 => string) public vehicleRegistration;
    mapping(bytes32 => address) public dispatchConfirmedBy;
    mapping(bytes32 => mapping(address => bool)) public locationTracked;
    mapping(bytes32 => mapping(address => mapping(bytes32 => uint256))) public locationStock;
    event RoadTransportRecorded(bytes32 indexed transferId, bytes32 fromLocation, bytes32 toLocation, string vehicle, uint64 actualDispatch, uint64 recordedAt, address confirmedBy);
    function createRoadTransfer(bytes32 transferId, bytes32 batchId, address recipient, uint256 quantity, uint64 expectedAt, bytes32 shipmentHash, string calldata cid, bytes32 fromLocation, bytes32 toLocation, uint64 occurredAt, string calldata vehicle) external {
        if (IOrderLocations(supplyOrders).locationOwner(fromLocation) != msg.sender || IOrderLocations(supplyOrders).locationOwner(toLocation) != recipient || occurredAt == 0 || occurredAt > block.timestamp || expectedAt <= occurredAt || bytes(vehicle).length < 2 || bytes(vehicle).length > 32) revert InvalidInput();
        bool meaningful;
        for (uint256 i; i < bytes(vehicle).length; ++i) {
            bytes1 c = bytes(vehicle)[i];
            if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || c == 0x20 || c == 0x2d)) revert InvalidInput();
            if (c != 0x20 && c != 0x2d) meaningful = true;
        }
        if (!meaningful) revert InvalidInput();
        _initialize(batchId);
        if (occurredAt < ProductRegistry(address(products)).getProduct(batchId).producedAt) revert InvalidInput();
        if (!locationTracked[batchId][msg.sender]) {
            if (products.manufacturerOf(batchId) != msg.sender || ProductRegistry(address(products)).productionLocation(batchId) != fromLocation) revert InvalidState();
            locationTracked[batchId][msg.sender] = true; locationStock[batchId][msg.sender][fromLocation] = inventory[batchId][msg.sender].available;
        }
        if (locationStock[batchId][msg.sender][fromLocation] < quantity) revert InsufficientInventory();
        locationStock[batchId][msg.sender][fromLocation] -= quantity;
        _createTransfer(msg.sender, transferId, batchId, recipient, quantity, expectedAt, shipmentHash, cid, true);
        _recordLocations(transferId, fromLocation, toLocation, occurredAt);
        vehicleRegistration[transferId] = vehicle; dispatchConfirmedBy[transferId] = msg.sender;
        emit RoadTransportRecorded(transferId, fromLocation, toLocation, vehicle, occurredAt, uint64(block.timestamp), msg.sender);
    }
    enum Status {
        None,
        AwaitingReceipt,
        Received,
        Rejected,
        Cancelled,
        DiscrepancyReported
    }
    enum DiscrepancyType {
        None,
        Shortage,
        Excess,
        Damage,
        WrongProduct,
        Other
    }
    struct Inventory {
        uint256 available;
        uint256 reserved;
        uint256 damaged;
        uint256 rejected;
    }
    struct Transfer {
        bytes32 productBatchId;
        address sender;
        address recipient;
        uint256 quantity;
        bytes32 shipmentHash;
        string shipmentCid;
        uint64 dispatchedAt;
        uint64 expectedAt;
        Status status;
        uint256 usable;
        uint256 damaged;
        uint256 rejected;
    }
    struct Discrepancy {
        DiscrepancyType kind;
        uint256 actualQuantity;
        bytes32 detailsHash;
        string evidenceCid;
        bool resolved;
    }
    error Unauthorized(address caller);
    error InvalidInput();
    error InvalidState();
    error InsufficientInventory();
    IStakeholderRegistry public immutable stakeholders;
    IProductRegistry public immutable products;
    mapping(bytes32 => Transfer) private transfers;
    mapping(bytes32 => mapping(address => Inventory)) private inventory;
    mapping(bytes32 => bool) private initialized;
    mapping(bytes32 => Discrepancy) private discrepancies;
    address public supplyOrders;
    mapping(bytes32 => uint256) public orderReserved;
    mapping(bytes32 => bytes32) public transferOrder;
    mapping(bytes32 => address) public orderBuyer;
    mapping(bytes32 => uint256) public orderForwarded;
    mapping(bytes32 => uint256) public missingQuantity;
    mapping(bytes32 => uint64) public receiptOccurredAt;
    mapping(bytes32 => uint64) public receiptRecordedAt;
    mapping(bytes32 => uint64) public reportedDispatchAt;
    mapping(bytes32 => bytes32) public dispatchLocation;
    mapping(bytes32 => bytes32) public receivingLocation;
    event OrderTransferLinked(bytes32 indexed transferId, bytes32 indexed orderId);
    event MissingRecorded(bytes32 indexed transferId, uint256 missing);
    event TransferLocationsRecorded(bytes32 indexed transferId, bytes32 fromLocation, bytes32 toLocation, uint64 occurredAt, uint64 recordedAt);
    event ReceiptTimesRecorded(bytes32 indexed transferId, uint64 occurredAt, uint64 recordedAt);
    function recordOrderLocations(bytes32 transferId, bytes32 fromLocation, bytes32 toLocation, uint64 occurredAt) external {
        if (msg.sender != supplyOrders) revert Unauthorized(msg.sender);
        _recordLocations(transferId, fromLocation, toLocation, occurredAt);
    }
    function _recordLocations(bytes32 transferId, bytes32 fromLocation, bytes32 toLocation, uint64 occurredAt) private {
        Transfer storage transfer = _transfer(transferId);
        if (IOrderLocations(supplyOrders).locationOwner(fromLocation) != transfer.sender || IOrderLocations(supplyOrders).locationOwner(toLocation) != transfer.recipient || occurredAt == 0 || occurredAt > block.timestamp) revert InvalidInput();
        reportedDispatchAt[transferId] = occurredAt; dispatchLocation[transferId] = fromLocation; receivingLocation[transferId] = toLocation;
        emit TransferLocationsRecorded(transferId, fromLocation, toLocation, occurredAt, uint64(block.timestamp));
    }
    function configureSupplyOrders(address registry) external {
        if (!stakeholders.isAuthorized(msg.sender, 1) || registry.code.length == 0 || supplyOrders != address(0)) revert Unauthorized(msg.sender);
        supplyOrders = registry;
    }
    function reserveOrder(bytes32 orderId, bytes32 batchId, address seller, address buyer, uint256 quantity) external {
        if (msg.sender != supplyOrders) revert Unauthorized(msg.sender);
        if (products.manufacturerOf(batchId) != seller || !products.isTransferable(batchId)) revert InvalidState();
        _initialize(batchId);
        Inventory storage stock = inventory[batchId][seller];
        if (stock.available < quantity) revert InsufficientInventory();
        stock.available -= quantity; stock.reserved += quantity; orderReserved[orderId] += quantity;
        orderBuyer[orderId] = buyer;
    }
    function releaseOrder(bytes32 orderId, bytes32 batchId, address seller, uint256 quantity) external {
        if (msg.sender != supplyOrders || orderReserved[orderId] < quantity) revert Unauthorized(msg.sender);
        orderReserved[orderId] -= quantity;
        inventory[batchId][seller].reserved -= quantity; inventory[batchId][seller].available += quantity;
    }
    function dispatchOrder(bytes32 orderId, bytes32 transferId, bytes32 batchId, address seller, address distributor, uint256 quantity, uint64 expectedAt, bytes32 shipmentHash, string calldata cid) external {
        if (msg.sender != supplyOrders || orderReserved[orderId] < quantity) revert Unauthorized(msg.sender);
        orderReserved[orderId] -= quantity;
        inventory[batchId][seller].reserved -= quantity; inventory[batchId][seller].available += quantity;
        _createTransfer(seller, transferId, batchId, distributor, quantity, expectedAt, shipmentHash, cid, false);
        transferOrder[transferId] = orderId;
        emit OrderTransferLinked(transferId, orderId);
    }
    function forwardOrder(bytes32 originalTransferId, bytes32 transferId, uint256 quantity, uint64 expectedAt, bytes32 shipmentHash, string calldata cid) private {
        Transfer storage original = _transfer(originalTransferId);
        bytes32 orderId = transferOrder[originalTransferId];
        if (orderId == bytes32(0) || original.recipient != msg.sender || original.status != Status.Received || orderForwarded[originalTransferId] + quantity > original.usable) revert InvalidState();
        orderForwarded[originalTransferId] += quantity;
        _createTransfer(msg.sender, transferId, original.productBatchId, orderBuyer[orderId], quantity, expectedAt, shipmentHash, cid, false);
        transferOrder[transferId] = orderId;
        emit OrderTransferLinked(transferId, orderId);
    }
    function forwardOrderAt(bytes32 originalTransferId, bytes32 transferId, uint256 quantity, uint64 expectedAt, bytes32 shipmentHash, string calldata cid, bytes32 fromLocation, bytes32 toLocation, uint64 occurredAt) external {
        if (occurredAt < receiptOccurredAt[originalTransferId]) revert InvalidInput();
        forwardOrder(originalTransferId, transferId, quantity, expectedAt, shipmentHash, cid);
        _recordLocations(transferId, fromLocation, toLocation, occurredAt);
    }
    event InventoryInitialized(
        bytes32 indexed productBatchId,
        address indexed manufacturer,
        uint256 quantity
    );
    event TransferCreated(
        bytes32 indexed transferId,
        bytes32 indexed productBatchId,
        address indexed sender,
        address recipient,
        uint256 quantity,
        bytes32 shipmentHash,
        string shipmentCid
    );
    event TransferStatusChanged(bytes32 indexed transferId, Status status, bytes32 reasonHash);
    event ReceiptConfirmed(
        bytes32 indexed transferId,
        address indexed recipient,
        uint256 usable,
        uint256 damaged,
        uint256 rejected,
        bytes32 receiptHash,
        string receiptCid
    );
    event DiscrepancyReported(
        bytes32 indexed transferId,
        DiscrepancyType kind,
        uint256 expected,
        uint256 actual,
        bytes32 detailsHash,
        string evidenceCid
    );
    constructor(address stakeholderRegistry, address productRegistry) {
        stakeholders = IStakeholderRegistry(stakeholderRegistry);
        products = IProductRegistry(productRegistry);
        productDelivery=new ProductDelivery(address(this),stakeholderRegistry,productRegistry);
    }
    function createTransfer(
        bytes32 transferId,
        bytes32 productBatchId,
        address recipient,
        uint256 quantity,
        uint64 expectedAt,
        bytes32 shipmentHash,
        string calldata shipmentCid
    ) external {
        _createTransfer(msg.sender, transferId, productBatchId, recipient, quantity, expectedAt, shipmentHash, shipmentCid, false);
    }
    function _createTransfer(address sender, bytes32 transferId, bytes32 productBatchId, address recipient, uint256 quantity, uint64 expectedAt, bytes32 shipmentHash, string memory shipmentCid, bool located) private {
        if (!located && locationTracked[productBatchId][sender]) revert InvalidState();
        uint8 senderRole = stakeholders.roleOf(sender);
        uint8 recipientRole = stakeholders.roleOf(recipient);
        if (
            !stakeholders.hasPermission(sender, keccak256('INITIATE_TRANSFER')) ||
            !stakeholders.hasPermission(recipient, keccak256('RECEIVE_TRANSFER')) ||
            !((senderRole == 3 && recipientRole == 4) || (senderRole == 4 && recipientRole == 5) ||
              (senderRole==3&&recipientRole==5&&msg.sender==address(productDelivery)&&productDeliveryCarrier[transferId]!=address(0)))
        )
            revert Unauthorized(msg.sender);
        if (
            transferId == bytes32(0) ||
            productBatchId == bytes32(0) ||
            recipient == address(0) ||
            recipient == sender ||
            quantity == 0 ||
            expectedAt < block.timestamp ||
            shipmentHash == bytes32(0) ||
            transfers[transferId].status != Status.None ||
            !products.isTransferable(productBatchId)
        ) revert InvalidInput();
        _initialize(productBatchId);
        Inventory storage senderInventory = inventory[productBatchId][sender];
        if (senderInventory.available < quantity) revert InsufficientInventory();
        senderInventory.available -= quantity;
        senderInventory.reserved += quantity;
        transfers[transferId] = Transfer(
            productBatchId,
            sender,
            recipient,
            quantity,
            shipmentHash,
            shipmentCid,
            uint64(block.timestamp),
            expectedAt,
            Status.AwaitingReceipt,
            0,
            0,
            0
        );
        emit TransferCreated(
            transferId,
            productBatchId,
            sender,
            recipient,
            quantity,
            shipmentHash,
            shipmentCid
        );
    }
    function cancel(bytes32 transferId, bytes32 reasonHash) external {
        if(productDeliveryOrder[transferId]!=bytes32(0))revert InvalidState();
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.sender) revert Unauthorized(msg.sender);
        if (transfer.status != Status.AwaitingReceipt) revert InvalidState();
        _release(transferId, transfer);
        transfer.status = Status.Cancelled;
        emit TransferStatusChanged(transferId, transfer.status, reasonHash);
    }
    function reject(bytes32 transferId, bytes32 reasonHash) external {
        if(productDeliveryOrder[transferId]!=bytes32(0))revert InvalidState();
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.recipient) revert Unauthorized(msg.sender);
        if (transfer.status != Status.AwaitingReceipt) revert InvalidState();
        _release(transferId, transfer);
        transfer.rejected = transfer.quantity;
        transfer.status = Status.Rejected;
        emit TransferStatusChanged(transferId, transfer.status, reasonHash);
    }
    function reportDiscrepancy(
        bytes32 transferId,
        DiscrepancyType kind,
        uint256 actualQuantity,
        bytes32 detailsHash,
        string calldata evidenceCid
    ) external {
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.recipient) revert Unauthorized(msg.sender);
        if (
            transfer.status != Status.AwaitingReceipt ||
            kind == DiscrepancyType.None ||
            detailsHash == bytes32(0) ||
            actualQuantity == transfer.quantity
        ) revert InvalidState();
        discrepancies[transferId] = Discrepancy(
            kind,
            actualQuantity,
            detailsHash,
            evidenceCid,
            false
        );
        transfer.status = Status.DiscrepancyReported;
        emit DiscrepancyReported(
            transferId,
            kind,
            transfer.quantity,
            actualQuantity,
            detailsHash,
            evidenceCid
        );
    }
    function resolveDiscrepancy(
        bytes32 transferId,
        bool acceptActual,
        bytes32 reasonHash
    ) external {
        if (!stakeholders.isAuthorized(msg.sender, 1)) revert Unauthorized(msg.sender);
        Transfer storage transfer = _transfer(transferId);
        Discrepancy storage discrepancy = discrepancies[transferId];
        if (transfer.status != Status.DiscrepancyReported || discrepancy.resolved)
            revert InvalidState();
        discrepancy.resolved = true;
        if (!acceptActual) {
            _release(transferId, transfer);
            if(productDeliveryOrder[transferId]!=bytes32(0))productDelivery.cancelAfterReconciliation(productDeliveryOrder[transferId],transferId);
            transfer.status = Status.Cancelled;
            emit TransferStatusChanged(transferId, transfer.status, reasonHash);
        } else {
            Inventory storage sender = inventory[transfer.productBatchId][transfer.sender];
            if (discrepancy.actualQuantity < transfer.quantity) {
                uint256 released = transfer.quantity - discrepancy.actualQuantity;
                sender.reserved -= released;
                sender.available += released;
                if (bytes(vehicleRegistration[transferId]).length > 0) locationStock[transfer.productBatchId][transfer.sender][dispatchLocation[transferId]] += released;
            } else if (discrepancy.actualQuantity > transfer.quantity) {
                uint256 extra = discrepancy.actualQuantity - transfer.quantity;
                if (sender.available < extra) revert InsufficientInventory();
                if (bytes(vehicleRegistration[transferId]).length > 0) {
                    if (locationStock[transfer.productBatchId][transfer.sender][dispatchLocation[transferId]] < extra) revert InsufficientInventory();
                    locationStock[transfer.productBatchId][transfer.sender][dispatchLocation[transferId]] -= extra;
                }
                sender.available -= extra;
                sender.reserved += extra;
            }
            transfer.status = Status.AwaitingReceipt;
            transfer.quantity = discrepancy.actualQuantity;
            emit TransferStatusChanged(transferId, transfer.status, reasonHash);
        }
    }
    function confirmReceipt(
        bytes32 transferId,
        uint256 totalReceived,
        uint256 damaged,
        uint256 rejectedQuantity,
        bytes32 receiptHash,
        string calldata receiptCid
    ) external {
        _confirmReceipt(transferId, totalReceived, damaged, rejectedQuantity, 0, receiptHash, receiptCid);
    }
    function confirmReceiptWithMissing(bytes32 transferId, uint256 accepted, uint256 damaged, uint256 rejectedQuantity, uint256 missing, uint64 occurredAt, bytes32 receiptHash, string calldata receiptCid) external {
        uint64 dispatched = reportedDispatchAt[transferId] == 0 ? _transfer(transferId).dispatchedAt : reportedDispatchAt[transferId];
        if (occurredAt < dispatched || occurredAt > block.timestamp) revert InvalidInput();
        receiptOccurredAt[transferId] = occurredAt;
        _confirmReceipt(transferId, accepted + damaged + rejectedQuantity, damaged, rejectedQuantity, missing, receiptHash, receiptCid);
        emit ReceiptTimesRecorded(transferId, occurredAt, uint64(block.timestamp));
    }
    function _confirmReceipt(bytes32 transferId, uint256 totalReceived, uint256 damaged, uint256 rejectedQuantity, uint256 missing, bytes32 receiptHash, string memory receiptCid) private {
        if(productDeliveryOrder[transferId]!=bytes32(0)&&receiptOccurredAt[transferId]==0)revert InvalidInput();
        Transfer storage transfer = _transfer(transferId);
        if (
            msg.sender != transfer.recipient ||
            !stakeholders.hasPermission(msg.sender, keccak256('RECEIVE_TRANSFER'))
        )
            revert Unauthorized(msg.sender);
        if (
            transfer.status != Status.AwaitingReceipt ||
            totalReceived + missing != transfer.quantity ||
            damaged + rejectedQuantity > totalReceived ||
            receiptHash == bytes32(0)
        ) revert InvalidState();
        uint256 usable = totalReceived - damaged - rejectedQuantity;
        Inventory storage senderInventory = inventory[transfer.productBatchId][transfer.sender];
        senderInventory.reserved -= transfer.quantity;
        Inventory storage receiverInventory = inventory[transfer.productBatchId][msg.sender];
        receiverInventory.available += usable;
        if (bytes(vehicleRegistration[transferId]).length > 0) {
            locationTracked[transfer.productBatchId][msg.sender] = true;
            locationStock[transfer.productBatchId][msg.sender][receivingLocation[transferId]] += usable;
        }
        receiverInventory.damaged += damaged;
        receiverInventory.rejected += rejectedQuantity;
        transfer.usable = usable;
        transfer.damaged = damaged;
        transfer.rejected = rejectedQuantity;
        transfer.status = Status.Received;
        missingQuantity[transferId] = missing;
        receiptRecordedAt[transferId] = uint64(block.timestamp);
        if(productDeliveryOrder[transferId]!=bytes32(0))productDelivery.complete(productDeliveryOrder[transferId],transferId,receiptOccurredAt[transferId]);
        emit MissingRecorded(transferId, missing);
        emit ReceiptConfirmed(
            transferId,
            msg.sender,
            usable,
            damaged,
            rejectedQuantity,
            receiptHash,
            receiptCid
        );
    }
    function getTransfer(bytes32 id) external view returns (Transfer memory) {
        return _transfer(id);
    }
    function getInventory(
        bytes32 batchId,
        address holder
    ) external view returns (Inventory memory) {
        return inventory[batchId][holder];
    }
    function getDiscrepancy(bytes32 id) external view returns (Discrepancy memory) {
        return discrepancies[id];
    }
    function _initialize(bytes32 batchId) private {
        if (!initialized[batchId]) {
            address manufacturer = products.manufacturerOf(batchId);
            uint256 quantity = products.totalQuantityOf(batchId);
            inventory[batchId][manufacturer].available = quantity;
            initialized[batchId] = true;
            emit InventoryInitialized(batchId, manufacturer, quantity);
        }
    }
    function _release(bytes32 transferId, Transfer storage transfer) private {
        if (bytes(vehicleRegistration[transferId]).length > 0) locationStock[transfer.productBatchId][transfer.sender][dispatchLocation[transferId]] += transfer.quantity;
        Inventory storage sender = inventory[transfer.productBatchId][transfer.sender];
        sender.reserved -= transfer.quantity;
        sender.available += transfer.quantity;
    }
    function _transfer(bytes32 id) private view returns (Transfer storage transfer) {
        transfer = transfers[id];
        if (transfer.status == Status.None) revert InvalidInput();
    }
}
