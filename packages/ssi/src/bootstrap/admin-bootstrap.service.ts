import { CompanyRole } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { createOrGetAuthorityDid } from '../did/authority-did.service.js';
import {
  CompanyRoleCredentialStatus,
  companyRoleCredentialSchema,
  issuerDidOf,
} from '../credentials/company-role-credential.js';
import {
  issueCompanyRoleCredential,
  walletAddressToDid,
} from '../credentials/company-role-credential.service.js';
import { verifyCompanyRoleCredential } from '../credentials/verification.service.js';

export interface BootstrapSystemAdminInput {
  adminWalletAddress: string;
  authorityDidAlias: string;
  credentialLifetimeDays?: number;
  now?: Date;
}

export interface BootstrapSystemAdminResult {
  authorityDid: string;
  authorityDidCreated: boolean;
  credentialHash: string;
  credentialId: string;
  credentialIssued: boolean;
  subjectDid: string;
  walletAddress: string;
}

export async function bootstrapSystemAdmin(
  agent: TraceChainAgent,
  input: BootstrapSystemAdminInput,
): Promise<BootstrapSystemAdminResult> {
  const now = input.now ?? new Date();
  const walletAddress = getAddress(input.adminWalletAddress);
  const subjectDid = walletAddressToDid(walletAddress);
  const authority = await createOrGetAuthorityDid(agent, input.authorityDidAlias);

  const storedCredentials = await agent.dataStoreORMGetVerifiableCredentials({});
  for (const stored of storedCredentials) {
    const parsed = companyRoleCredentialSchema.safeParse(stored.verifiableCredential);
    if (!parsed.success) continue;

    const credential = parsed.data;
    const isMatchingActiveBootstrap =
      issuerDidOf(credential) === authority.identifier.did &&
      credential.credentialSubject.id.toLowerCase() === subjectDid.toLowerCase() &&
      credential.credentialSubject.companyId === 'TRACECHAIN_AUTHORITY' &&
      credential.credentialSubject.role === CompanyRole.SYSTEM_ADMIN &&
      credential.credentialStatus.status === CompanyRoleCredentialStatus.ACTIVE &&
      new Date(credential.expirationDate).getTime() > now.getTime();

    if (!isMatchingActiveBootstrap) continue;

    const verification = await verifyCompanyRoleCredential(
      agent,
      credential,
      walletAddress,
      authority.identifier.did,
      now,
    );
    if (!verification.verified || !verification.credentialHash || !verification.credentialId)
      continue;

    return {
      authorityDid: authority.identifier.did,
      authorityDidCreated: authority.created,
      credentialHash: verification.credentialHash,
      credentialId: verification.credentialId,
      credentialIssued: false,
      subjectDid,
      walletAddress,
    };
  }

  const expirationDate = new Date(now);
  expirationDate.setUTCDate(expirationDate.getUTCDate() + (input.credentialLifetimeDays ?? 365));
  const issued = await issueCompanyRoleCredential(agent, {
    companyId: 'TRACECHAIN_AUTHORITY',
    companyName: 'Product Traceability Authority',
    expirationDate,
    issuanceDate: now,
    issuerDid: authority.identifier.did,
    role: CompanyRole.SYSTEM_ADMIN,
    subjectDid,
    walletAddress,
  });

  return {
    authorityDid: authority.identifier.did,
    authorityDidCreated: authority.created,
    credentialHash: issued.credentialHash,
    credentialId: issued.credential.id,
    credentialIssued: true,
    subjectDid,
    walletAddress,
  };
}
