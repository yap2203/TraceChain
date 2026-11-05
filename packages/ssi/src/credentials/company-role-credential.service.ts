import { createHash, randomUUID } from 'node:crypto';

import { CompanyRole } from '@tracechain/shared';
import type { VerifiableCredential } from '@veramo/core';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { SEPOLIA_NETWORK_NAME } from '../config/ssi-config.js';
import {
  COMPANY_ROLE_CREDENTIAL_CONTEXT,
  COMPANY_ROLE_CREDENTIAL_SCHEMA_ID,
  COMPANY_ROLE_CREDENTIAL_TYPE,
  CompanyRoleCredentialStatus,
  TRACECHAIN_CREDENTIAL_STATUS_TYPE,
  TRACECHAIN_DEMO_AUTHORITY_NAME,
  companyRoleCredentialSchema,
  type CompanyRoleCredential,
} from './company-role-credential.js';

export interface IssueCompanyRoleCredentialInput {
  applicationReference: string;
  companyId: string;
  companyName: string;
  companyRegistrationNumber: string;
  expirationDate: Date;
  issuanceDate?: Date;
  issuerDid: string;
  issuerOperatorChainId: number;
  issuerOperatorWallet: string;
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
      credentialSchema: {
        id: COMPANY_ROLE_CREDENTIAL_SCHEMA_ID,
        type: 'JsonSchema',
      },
      credentialSubject: {
        applicationReference: input.applicationReference,
        companyId: input.companyId,
        companyName: input.companyName,
        companyRegistrationNumber: input.companyRegistrationNumber,
        id: expectedSubjectDid,
        role: input.role,
        walletAddress,
      },
      expirationDate: input.expirationDate.toISOString(),
      id: credentialId,
      issuanceDate: (input.issuanceDate ?? new Date()).toISOString(),
      issuer: {
        blockchainAccountId: `eip155:${input.issuerOperatorChainId}:${getAddress(input.issuerOperatorWallet)}`,
        id: input.issuerDid,
        name: TRACECHAIN_DEMO_AUTHORITY_NAME,
      },
      type: ['VerifiableCredential', COMPANY_ROLE_CREDENTIAL_TYPE],
    },
    proofFormat: 'jwt',
    save: false,
  });

  const validated = companyRoleCredentialSchema.parse(credential) as CompanyRoleCredential;
  await agent.dataStoreSaveVerifiableCredential({
    verifiableCredential: validated as VerifiableCredential,
  });
  const credentialHash = hashCompanyRoleCredential(validated);

  return { credential: validated, credentialHash };
}

export function serializeCompanyRoleCredential(credential: CompanyRoleCredential): string {
  return JSON.stringify(sortJson(credential));
}

export function hashCompanyRoleCredential(credential: CompanyRoleCredential): string {
  return createHash('sha256').update(serializeCompanyRoleCredential(credential), 'utf8').digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}
