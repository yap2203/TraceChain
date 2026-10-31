import { createHash, randomUUID } from 'node:crypto';

import { CompanyRole } from '@tracechain/shared';
import type { VerifiableCredential } from '@veramo/core';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { SEPOLIA_NETWORK_NAME } from '../config/ssi-config.js';
import {
  COMPANY_ROLE_CREDENTIAL_CONTEXT,
  COMPANY_ROLE_CREDENTIAL_TYPE,
  CompanyRoleCredentialStatus,
  TRACECHAIN_CREDENTIAL_STATUS_TYPE,
  companyRoleCredentialSchema,
  type CompanyRoleCredential,
} from './company-role-credential.js';

export interface IssueCompanyRoleCredentialInput {
  companyId: string;
  companyName: string;
  expirationDate: Date;
  issuanceDate?: Date;
  issuerDid: string;
  role: CompanyRole;
  subjectDid: string;
  walletAddress: string;
}

export function walletAddressToDid(walletAddress: string): string {
  return `did:ethr:${SEPOLIA_NETWORK_NAME}:${getAddress(walletAddress)}`;
}

export async function issueCompanyRoleCredential(
  agent: TraceChainAgent,
  input: IssueCompanyRoleCredentialInput,
): Promise<{ credential: CompanyRoleCredential; credentialHash: string }> {
  const walletAddress = getAddress(input.walletAddress);
  const expectedSubjectDid = walletAddressToDid(walletAddress);
  if (input.subjectDid.toLowerCase() !== expectedSubjectDid.toLowerCase()) {
    throw new Error('Subject DID does not match the supplied wallet address');
  }

  const credentialId = `urn:uuid:${randomUUID()}`;
  const credential = await agent.createVerifiableCredential({
    credential: {
      '@context': [COMPANY_ROLE_CREDENTIAL_CONTEXT],
      credentialStatus: {
        id: `urn:tracechain:credential-status:${credentialId.slice('urn:uuid:'.length)}`,
        status: CompanyRoleCredentialStatus.ACTIVE,
        type: TRACECHAIN_CREDENTIAL_STATUS_TYPE,
      },
      credentialSubject: {
        companyId: input.companyId,
        companyName: input.companyName,
        id: expectedSubjectDid,
        role: input.role,
        walletAddress,
      },
      expirationDate: input.expirationDate.toISOString(),
      id: credentialId,
      issuanceDate: (input.issuanceDate ?? new Date()).toISOString(),
      issuer: { id: input.issuerDid },
      type: ['VerifiableCredential', COMPANY_ROLE_CREDENTIAL_TYPE],
    },
    proofFormat: 'jwt',
    save: false,
  });

  const validated = companyRoleCredentialSchema.parse(credential) as CompanyRoleCredential;
  await agent.dataStoreSaveVerifiableCredential({
    verifiableCredential: validated as VerifiableCredential,
  });
  const credentialHash = createHash('sha256').update(validated.proof.jwt, 'utf8').digest('hex');

  return { credential: validated, credentialHash };
}
