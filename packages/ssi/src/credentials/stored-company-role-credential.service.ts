import { CompanyRole } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import {
  CompanyRoleCredentialStatus,
  companyRoleCredentialSchema,
  issuerDidOf,
  type CompanyRoleCredential,
} from './company-role-credential.js';
import { walletAddressToDid } from './company-role-credential.service.js';
import { verifyCompanyRoleCredential } from './verification.service.js';

export interface StoredCompanyRoleCredentialMatch {
  credential: CompanyRoleCredential;
  credentialHash: string;
}

export interface FindStoredCompanyRoleCredentialInput {
  authorityDid: string;
  companyId: string;
  role: CompanyRole;
  walletAddress: string;
  now?: Date;
}

/** Finds only a still-valid, cryptographically verified credential in the local issuer store. */
export async function findStoredCompanyRoleCredential(
  agent: TraceChainAgent,
  input: FindStoredCompanyRoleCredentialInput,
): Promise<StoredCompanyRoleCredentialMatch | undefined> {
  const now = input.now ?? new Date();
  const walletAddress = getAddress(input.walletAddress);
  const subjectDid = walletAddressToDid(walletAddress);
  const storedCredentials = await agent.dataStoreORMGetVerifiableCredentials({});

  for (const stored of storedCredentials) {
    const parsed = companyRoleCredentialSchema.safeParse(stored.verifiableCredential);
    if (!parsed.success) continue;

    const credential = parsed.data as CompanyRoleCredential;
    if (
      issuerDidOf(credential) !== input.authorityDid ||
      credential.credentialSubject.id.toLowerCase() !== subjectDid.toLowerCase() ||
      credential.credentialSubject.companyId !== input.companyId ||
      credential.credentialSubject.role !== input.role ||
      credential.credentialSubject.walletAddress.toLowerCase() !== walletAddress.toLowerCase() ||
      credential.credentialStatus.status !== CompanyRoleCredentialStatus.ACTIVE ||
      new Date(credential.expirationDate).getTime() <= now.getTime()
    ) {
      continue;
    }

    const verification = await verifyCompanyRoleCredential(
      agent,
      credential,
      walletAddress,
      input.authorityDid,
      now,
    );
    if (verification.verified && verification.credentialHash) {
      return { credential, credentialHash: verification.credentialHash };
    }
  }

  return undefined;
}
