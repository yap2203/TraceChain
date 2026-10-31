import { createHash } from 'node:crypto';

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

export type CompanyRoleCredentialFailureReason =
  | 'MALFORMED_CREDENTIAL'
  | 'INVALID_SIGNATURE'
  | 'UNTRUSTED_ISSUER'
  | 'WRONG_WALLET'
  | 'UNSUPPORTED_ROLE'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'INACTIVE_STATUS';

export interface CompanyRoleCredentialVerificationResult {
  authorizationReady: false;
  credentialHash?: string;
  credentialId?: string;
  issuerDid?: string;
  onChainStatusChecked: false;
  reasons: CompanyRoleCredentialFailureReason[];
  role?: CompanyRole;
  subjectDid?: string;
  verified: boolean;
  walletAddress?: string;
}

function hashEncodedCredential(credential: CompanyRoleCredential): string {
  return createHash('sha256').update(credential.proof.jwt, 'utf8').digest('hex');
}

export async function verifyCompanyRoleCredential(
  agent: TraceChainAgent,
  credentialInput: unknown,
  authenticatedWalletAddress: string,
  trustedAuthorityDid: string,
  now = new Date(),
): Promise<CompanyRoleCredentialVerificationResult> {
  const baseResult = { authorizationReady: false, onChainStatusChecked: false } as const;
  const parsed = companyRoleCredentialSchema.safeParse(credentialInput);
  if (!parsed.success) {
    const unsupportedRole = parsed.error.issues.some(
      (issue) => issue.path.join('.') === 'credentialSubject.role',
    );
    return {
      ...baseResult,
      reasons: [unsupportedRole ? 'UNSUPPORTED_ROLE' : 'MALFORMED_CREDENTIAL'],
      verified: false,
    };
  }

  const credential = parsed.data as CompanyRoleCredential;
  const issuerDid = issuerDidOf(credential);
  const reasons: CompanyRoleCredentialFailureReason[] = [];
  let walletAddress: string | undefined;

  if (issuerDid !== trustedAuthorityDid) reasons.push('UNTRUSTED_ISSUER');

  try {
    walletAddress = getAddress(authenticatedWalletAddress);
    const claimedWallet = getAddress(credential.credentialSubject.walletAddress);
    const expectedSubjectDid = walletAddressToDid(walletAddress);
    if (
      claimedWallet !== walletAddress ||
      credential.credentialSubject.id.toLowerCase() !== expectedSubjectDid.toLowerCase()
    ) {
      reasons.push('WRONG_WALLET');
    }
  } catch {
    reasons.push('WRONG_WALLET');
  }

  const issuedAt = new Date(credential.issuanceDate);
  const expiresAt = new Date(credential.expirationDate);
  if (issuedAt.getTime() > now.getTime()) reasons.push('NOT_YET_VALID');
  if (expiresAt.getTime() <= now.getTime()) reasons.push('EXPIRED');
  if (credential.credentialStatus.status !== CompanyRoleCredentialStatus.ACTIVE) {
    reasons.push('INACTIVE_STATUS');
  }

  try {
    const verification = await agent.verifyCredential({
      credential,
      policies: {
        credentialStatus: false,
        expirationDate: false,
        issuanceDate: false,
        now: now.getTime() / 1000,
      },
    });
    if (!verification.verified) reasons.push('INVALID_SIGNATURE');
  } catch {
    reasons.push('INVALID_SIGNATURE');
  }

  const uniqueReasons = [...new Set(reasons)];
  const verified = uniqueReasons.length === 0;
  return {
    ...baseResult,
    credentialHash: hashEncodedCredential(credential),
    credentialId: credential.id,
    issuerDid,
    reasons: uniqueReasons,
    role: verified ? credential.credentialSubject.role : undefined,
    subjectDid: credential.credentialSubject.id,
    verified,
    walletAddress,
  };
}
