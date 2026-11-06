// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
interface IIngredientRegistry {
    function isUsable(bytes32 batchId) external view returns (bool);
    function isValidTraceabilitySource(bytes32 batchId) external view returns (bool);
    function consumeIngredient(bytes32 batchId, uint256 quantity, bytes32 productBatchId) external;
}
