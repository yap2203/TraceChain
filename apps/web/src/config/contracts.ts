import type { ContractRunner } from 'ethers';
import { Contract } from 'ethers';

import { contractAddresses } from './chain';

const stakeholderRegistryAbi = [
  'function submitApplication(bytes32 applicationId, bytes32 profileHash, string encryptedProfileCid, uint8 requestedRole, bytes32 previousApplicationId)',
  'function getApplication(bytes32 applicationId) view returns (tuple(address applicant,uint8 requestedRole,uint8 status,bytes32 profileHash,string encryptedProfileCid,bytes32 previousApplicationId,uint64 submittedAt,uint64 updatedAt))',
  'function getStakeholder(address account) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function roleOf(address account) view returns (uint8)',
  'function isActive(address account) view returns (bool)',
  'function applicationCount() view returns (uint256)',
  'function getApplicationIds(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function rejectApplication(bytes32 applicationId, bytes32 reasonHash)',
] as const;

export function stakeholderRegistry(runner: ContractRunner) {
  return new Contract(contractAddresses.stakeholderRegistry, stakeholderRegistryAbi, runner);
}
