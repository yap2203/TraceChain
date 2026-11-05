// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IStakeholderRegistry {
  function administrator() external view returns (address);
  function roleOf(address account) external view returns (uint8);
  function isActive(address account) external view returns (bool);
  function isAuthorized(address account, uint8 role) external view returns (bool);
  function hasPermission(address account, bytes32 permission) external view returns (bool);
  function credentialHashOf(address account) external view returns (bytes32);
}
