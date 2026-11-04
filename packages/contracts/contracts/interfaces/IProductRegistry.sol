// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
interface IProductRegistry {
    function isTransferable(bytes32 batchId) external view returns (bool);
    function manufacturerOf(bytes32 batchId) external view returns (address);
    function totalQuantityOf(bytes32 batchId) external view returns (uint256);
}
