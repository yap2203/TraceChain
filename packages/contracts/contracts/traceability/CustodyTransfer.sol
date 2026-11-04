// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IProductRegistry} from '../interfaces/IProductRegistry.sol';

contract CustodyTransfer {
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
        uint8 senderRole = stakeholders.roleOf(msg.sender);
        uint8 recipientRole = stakeholders.roleOf(recipient);
        if (!((senderRole == 3 && recipientRole == 4) || (senderRole == 4 && recipientRole == 5)))
            revert Unauthorized(msg.sender);
        if (
            transferId == bytes32(0) ||
            productBatchId == bytes32(0) ||
            recipient == address(0) ||
            recipient == msg.sender ||
            quantity == 0 ||
            expectedAt < block.timestamp ||
            shipmentHash == bytes32(0) ||
            transfers[transferId].status != Status.None ||
            !products.isTransferable(productBatchId)
        ) revert InvalidInput();
        _initialize(productBatchId);
        Inventory storage senderInventory = inventory[productBatchId][msg.sender];
        if (senderInventory.available < quantity) revert InsufficientInventory();
        senderInventory.available -= quantity;
        senderInventory.reserved += quantity;
        transfers[transferId] = Transfer(
            productBatchId,
            msg.sender,
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
            msg.sender,
            recipient,
            quantity,
            shipmentHash,
            shipmentCid
        );
    }
    function cancel(bytes32 transferId, bytes32 reasonHash) external {
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.sender) revert Unauthorized(msg.sender);
        if (transfer.status != Status.AwaitingReceipt) revert InvalidState();
        _release(transfer);
        transfer.status = Status.Cancelled;
        emit TransferStatusChanged(transferId, transfer.status, reasonHash);
    }
    function reject(bytes32 transferId, bytes32 reasonHash) external {
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.recipient) revert Unauthorized(msg.sender);
        if (transfer.status != Status.AwaitingReceipt) revert InvalidState();
        _release(transfer);
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
            _release(transfer);
            transfer.status = Status.Cancelled;
            emit TransferStatusChanged(transferId, transfer.status, reasonHash);
        } else {
            Inventory storage sender = inventory[transfer.productBatchId][transfer.sender];
            if (discrepancy.actualQuantity < transfer.quantity) {
                uint256 released = transfer.quantity - discrepancy.actualQuantity;
                sender.reserved -= released;
                sender.available += released;
            } else if (discrepancy.actualQuantity > transfer.quantity) {
                uint256 extra = discrepancy.actualQuantity - transfer.quantity;
                if (sender.available < extra) revert InsufficientInventory();
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
        Transfer storage transfer = _transfer(transferId);
        if (msg.sender != transfer.recipient || stakeholders.roleOf(msg.sender) == 0)
            revert Unauthorized(msg.sender);
        if (
            transfer.status != Status.AwaitingReceipt ||
            totalReceived != transfer.quantity ||
            damaged + rejectedQuantity > totalReceived ||
            receiptHash == bytes32(0)
        ) revert InvalidState();
        uint256 usable = totalReceived - damaged - rejectedQuantity;
        Inventory storage senderInventory = inventory[transfer.productBatchId][transfer.sender];
        senderInventory.reserved -= transfer.quantity;
        Inventory storage receiverInventory = inventory[transfer.productBatchId][msg.sender];
        receiverInventory.available += usable;
        receiverInventory.damaged += damaged;
        receiverInventory.rejected += rejectedQuantity;
        transfer.usable = usable;
        transfer.damaged = damaged;
        transfer.rejected = rejectedQuantity;
        transfer.status = Status.Received;
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
    function _release(Transfer storage transfer) private {
        Inventory storage sender = inventory[transfer.productBatchId][transfer.sender];
        sender.reserved -= transfer.quantity;
        sender.available += transfer.quantity;
    }
    function _transfer(bytes32 id) private view returns (Transfer storage transfer) {
        transfer = transfers[id];
        if (transfer.status == Status.None) revert InvalidInput();
    }
}
