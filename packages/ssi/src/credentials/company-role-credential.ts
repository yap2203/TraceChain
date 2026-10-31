import { CompanyRole } from '@tracechain/shared';
import type { VerifiableCredential } from '@veramo/core';
import { z } from 'zod';

export const COMPANY_ROLE_CREDENTIAL_CONTEXT = 'https://www.w3.org/2018/credentials/v1';
export const COMPANY_ROLE_CREDENTIAL_TYPE = 'CompanyRoleCredential';
export const TRACECHAIN_CREDENTIAL_STATUS_TYPE = 'TraceChainCredentialStatus';

export enum CompanyRoleCredentialStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

const issuerDidEthrSchema = z
  .string()
  .regex(/^did:ethr:sepolia:0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{66}|[0-9a-fA-F]{128})$/);
const subjectDidEthrSchema = z.string().regex(/^did:ethr:sepolia:0x[0-9a-fA-F]{40}$/);

export const companyRoleCredentialSchema = z.object({
  '@context': z
    .union([z.string(), z.array(z.union([z.string(), z.record(z.string(), z.unknown())]))])
    .refine(
      (context) =>
        (Array.isArray(context) ? context : [context]).includes(COMPANY_ROLE_CREDENTIAL_CONTEXT),
      'Standard Verifiable Credential context is required',
    ),
  credentialStatus: z.object({
    id: z.string().min(1),
    status: z.nativeEnum(CompanyRoleCredentialStatus),
    type: z.literal(TRACECHAIN_CREDENTIAL_STATUS_TYPE),
  }),
  credentialSubject: z.object({
    companyId: z.string().min(1),
    companyName: z.string().min(1),
    id: subjectDidEthrSchema,
    role: z.nativeEnum(CompanyRole),
    walletAddress: z.string().min(1),
  }),
  expirationDate: z.string().datetime(),
  id: z.string().min(1),
  issuanceDate: z.string().datetime(),
  issuer: z.union([issuerDidEthrSchema, z.object({ id: issuerDidEthrSchema })]),
  proof: z.object({
    jwt: z.string().min(1),
    type: z.literal('JwtProof2020'),
  }),
  type: z.union([z.string(), z.array(z.string())]).refine((types) => {
    const normalized = Array.isArray(types) ? types : [types];
    return (
      normalized.includes('VerifiableCredential') &&
      normalized.includes(COMPANY_ROLE_CREDENTIAL_TYPE)
    );
  }, 'CompanyRoleCredential and VerifiableCredential types are required'),
});

export type CompanyRoleCredential = z.infer<typeof companyRoleCredentialSchema> &
  VerifiableCredential;

export function issuerDidOf(credential: CompanyRoleCredential): string {
  return typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id;
}
