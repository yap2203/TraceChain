import { CompanyRole } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { createOrGetAuthorityDid } from '../did/authority-did.service.js';
import {
  issueCompanyRoleCredential,
  walletAddressToDid,
} from '../credentials/company-role-credential.service.js';
import { findStoredCompanyRoleCredential } from '../credentials/stored-company-role-credential.service.js';

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

  const existing = await findStoredCompanyRoleCredential(agent, {
    authorityDid: authority.identifier.did,
    companyId: 'TRACECHAIN_AUTHORITY',
    now,
    role: CompanyRole.SYSTEM_ADMIN,
    walletAddress,
  });
  if (existing) {
    return {
      authorityDid: authority.identifier.did,
      authorityDidCreated: authority.created,
      credentialHash: existing.credentialHash,
      credentialId: existing.credential.id,
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
