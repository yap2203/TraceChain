const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface PreparedTransaction {
  chainId: number;
  data: string;
  to: string;
  value: string;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function blockchainRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/blockchain${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'The blockchain request failed.');
  }
  return response.json() as Promise<T>;
}

export function getApplications<T>() {
  return blockchainRequest<{ applications: T[] }>('/applications');
}

export interface ChainCredential {
  applicationId: string;
  companyName: string;
  companyRegistrationNumber: string;
  credentialHash: string;
  credentialId: string;
  encryptedCredentialCid: string;
  expiresAt: number;
  issuedAt: number;
  issuer: string;
  role: string;
  status: 'active' | 'expired' | 'revoked' | 'suspended' | 'unknown';
  stakeholderStatus: 'active' | 'revoked' | 'suspended' | 'unknown';
  subject: string;
  stakeholderUpdatedAt: number;
  updatedAt: number;
}

export function getCompanyCredentials() {
  return blockchainRequest<{ credentials: ChainCredential[] }>('/credentials');
}

export function prepareCredentialLifecycle(input: {
  action: 'reactivate' | 'revoke' | 'suspend';
  credentialId: string;
  reasonHash?: string;
}) {
  return blockchainRequest<PreparedTransaction>('/transactions/credential-lifecycle', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function prepareStakeholderLifecycle(input: {
  account: string;
  action: 'reactivate' | 'revoke' | 'suspend';
  reasonHash?: string;
}) {
  return blockchainRequest<PreparedTransaction>('/transactions/stakeholder-lifecycle', {
    body: JSON.stringify(input), method: 'POST',
  });
}

export interface RolePermissionRecord { id: string; name: string; roles: Record<string, boolean> }
export function getRolePermissions() { return blockchainRequest<{ permissions: RolePermissionRecord[] }>('/role-permissions'); }
export function prepareRolePermission(input: { allowed: boolean; permission: string; role: number }) {
  return blockchainRequest<PreparedTransaction>('/transactions/role-permission', { body: JSON.stringify(input), method: 'POST' });
}

export function prepareCompanyApplication(input: {
  applicationId: string;
  companyName: string;
  companyRegistrationNumber: string;
  encryptedProfileCid: string;
  previousApplicationId: string;
  profileHash: string;
  requestedRole: number;
}) {
  return blockchainRequest<PreparedTransaction>('/transactions/company-application', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function prepareApplicationRejection(input: {
  applicationId: string;
  reasonHash: string;
}) {
  return blockchainRequest<PreparedTransaction>('/transactions/application-rejection', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}
import { JsonRpcProvider, type JsonRpcSigner } from 'ethers';

import { chainConfig } from '../../config/network';


export async function sendPreparedTransaction(
  signer: JsonRpcSigner,
  prepared: PreparedTransaction,
) {
  const transaction = { data: prepared.data, to: prepared.to, value: prepared.value };
  try {
    return await signer.sendTransaction(transaction);
  } catch (error) {
    if (prepared.chainId !== 31_337 || !isNonceTooHigh(error)) throw error;

    const address = await signer.getAddress();
    const nodeProvider = new JsonRpcProvider(chainConfig.rpcUrl, prepared.chainId, {
      staticNetwork: true,
    });
    const nonce = await nodeProvider.getTransactionCount(address, 'pending');
    try {
      return await signer.sendTransaction({ ...transaction, nonce });
    } catch (retryError) {
      if (!isNonceTooHigh(retryError)) throw retryError;
      throw new Error(
        `MetaMask is using a stale nonce for the reset local chain. Clear this account's activity/nonces in MetaMask, then retry; the node currently expects nonce ${nonce}.`,
      );
    }
  }
}

function isNonceTooHigh(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    error?: { message?: string };
    info?: { error?: { message?: string } };
    message?: string;
  };
  return [candidate.message, candidate.error?.message, candidate.info?.error?.message]
    .filter((message): message is string => Boolean(message))
    .some((message) => /nonce too high/i.test(message));
}
