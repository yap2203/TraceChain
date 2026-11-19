import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { COMPANY_ALWAYS_CLAIMS, companyDisclosureGroup } from '@tracechain/shared';
import { holderPublicJwk, issuerInstance, verifierInstance } from './ingredient-sd-jwt.js';

export const COMPANY_IDENTITY_SD_VCT = 'urn:tracechain:company-identity-proof:sd-jwt:v1';
export const COMPANY_IDENTITY_SD_VCT_V2 = 'urn:tracechain:company-identity-proof:sd-jwt:v2';
export const COMPANY_IDENTITY_BINDING_CLAIMS = ['id', 'walletAddress', 'role'] as const;

/** Authority-signed selective attestation derived from a verified existing VC. Not a replacement VC. */
export async function issueCompanyIdentitySdJwt(
  agent: TraceChainAgent,
  input: {
    issuerDid: string;
    holderDid: string;
    credentialHash: string;
    claims: Record<string, unknown>;
    requestId: string;
    purpose: string;
    audience: string;
    challenge: string;
    issuedAt: number;
    expiresAt: number;
    sourceCredentialId: string;
    sourceCredentialIssuedAt: string;
    sourceCredentialExpiresAt: string;
  },
) {
  const issuer = await agent.didManagerGet({ did: input.issuerDid });
  const key = issuer.keys.find((candidate) => candidate.type === 'Secp256k1');
  if (!key) throw new Error('The original Company Role issuer signing key is unavailable.');
  const claims = Object.fromEntries(
    Object.entries(input.claims).filter(([name]) =>
      [
        'companyId',
        'companyName',
        'companyRegistrationNumber',
        'registrationCountry',
        'role',
        'walletAddress',
        'id',
        'applicationReference',
      ].includes(name),
    ),
  );
  if (!claims.registrationCountry || !claims.companyRegistrationNumber) {
    delete claims.companyRegistrationNumber;
    delete claims.registrationCountry;
  }
  for (const name of COMPANY_ALWAYS_CLAIMS)
    if (!String(claims[name] ?? '').trim())
      throw new Error(`Missing company binding claim: ${name}`);
  return issuerInstance(agent, key.kid).issue(
    {
      iss: input.issuerDid,
      vct: COMPANY_IDENTITY_SD_VCT_V2,
      policyVersion: 2,
      cnf: { jwk: await holderPublicJwk(input.holderDid) },
      iat: input.issuedAt,
      exp: input.expiresAt,
      sourceCredentialHash: input.credentialHash,
      ...(input.sourceCredentialId
        ? {
            sourceCredentialId: input.sourceCredentialId,
            sourceCredentialIssuedAt: input.sourceCredentialIssuedAt,
            sourceCredentialExpiresAt: input.sourceCredentialExpiresAt,
          }
        : {}),
      holderDid: input.holderDid,
      requestId: input.requestId,
      purpose: input.purpose,
      audience: input.audience,
      challenge: input.challenge,
      ...claims,
    },
    {
      _sd: Object.keys(claims).filter((name) => !COMPANY_ALWAYS_CLAIMS.includes(name as never)),
    } as never,
    { header: { kid: key.kid, typ: 'dc+sd-jwt' } },
  );
}

export async function verifyCompanyIdentitySdJwt(
  agent: TraceChainAgent,
  presentation: string,
  input: {
    audience: string;
    challenge: string;
    requestId: string;
    purpose: string;
    now: number;
    requiredClaims: string[];
  },
) {
  const result = await verifierInstance(agent).verify(presentation, {
    allowedIssuerAlgorithms: ['ES256K'],
    allowedKeyBindingAlgorithms: ['EdDSA'],
    expectedVct: [COMPANY_IDENTITY_SD_VCT, COMPANY_IDENTITY_SD_VCT_V2],
    currentDate: input.now,
    expectedKeyBindingAudience: input.audience,
    keyBindingNonce: input.challenge,
    keyBindingMaxAgeSeconds: 300,
    requiredClaimKeys: [
      'iss',
      'vct',
      'cnf',
      'sourceCredentialHash',
      ...COMPANY_IDENTITY_BINDING_CLAIMS,
      ...input.requiredClaims,
    ],
  });
  const p = result.payload;
  if (p.vct === COMPANY_IDENTITY_SD_VCT_V2) {
    for (const key of [...COMPANY_ALWAYS_CLAIMS, ...companyDisclosureGroup(input.requiredClaims)])
      if (!p[key])
        throw new Error(
          `Required signed company claim is unavailable: ${key}. Authorized replacement may be needed.`,
        );
    if ('companyRegistrationNumber' in p !== 'registrationCountry' in p)
      throw new Error('Registration number and country must be disclosed together.');
  }
  const expectedJwk = await holderPublicJwk(String(p.holderDid ?? ''));
  const jwk = (p.cnf as { jwk?: { x?: string; crv?: string; kty?: string } } | undefined)?.jwk;
  if (jwk?.x !== expectedJwk.x || jwk?.crv !== expectedJwk.crv || jwk?.kty !== expectedJwk.kty)
    throw new Error('The company proof key does not match its holder DID.');
  if (
    p.requestId !== input.requestId ||
    p.purpose !== input.purpose ||
    p.audience !== input.audience ||
    p.challenge !== input.challenge
  )
    throw new Error('The selective company identity proof belongs to another request or verifier.');
  return result;
}
