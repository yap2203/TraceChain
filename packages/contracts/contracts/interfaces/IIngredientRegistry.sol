// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
interface IIngredientRegistry {
    function evidenceDetails(bytes32 batchId)
        external
        view
        returns (address supplier, bytes32 credentialId, bool validTraceabilitySource);
    function isUsable(bytes32 batchId) external view returns (bool);
    function isValidTraceabilitySource(bytes32 batchId) external view returns (bool);
    function consumeIngredient(bytes32 batchId, uint256 quantity, bytes32 productBatchId) external;
    function supplyOrders() external view returns (address);
    function consumeReceived(bytes32 batchId, uint256 quantity, bytes32 productBatchId, address manufacturer, bytes32 location) external;
}
