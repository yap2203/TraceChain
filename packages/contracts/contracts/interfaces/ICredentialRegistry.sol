// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface ICredentialRegistry {
  function credentialIdByHash(bytes32 credentialHash) external view returns (bytes32);
  function credentialSubject(bytes32 credentialId) external view returns (address);
  function credentialTypeOf(bytes32 credentialId) external view returns (uint8);
  function isCredentialValid(bytes32 credentialId) external view returns (bool);
}
