import { getAddress, ZeroHash } from 'ethers';
import {
  WALLET_HOLDER_BINDING,
  parseWalletPresentation,
  presentationSdJwt,
  verifyWalletPresentation,
} from '@tracechain/shared';
import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { COMPANY_ALWAYS_CLAIMS, companyDisclosureGroup } from '@tracechain/shared';
import { holderPublicJwk, issuerInstance, verifierInstance } from './ingredient-sd-jwt.js';

export const COMPANY_IDENTITY_SD_VCT_V3 = 'urn:tracechain:company-identity-proof:sd-jwt:v3';
export const COMPANY_IDENTITY_SD_VCT = 'urn:tracechain:company-identity-proof:sd-jwt:v1';
export const COMPANY_IDENTITY_SD_VCT_V2 = 'urn:tracechain:company-identity-proof:sd-jwt:v2';
export const COMPANY_IDENTITY_BINDING_CLAIMS = ['id', 'walletAddress', 'role'] as const;

/** Authority-signed selective attestation derived from a verified existing VC. Not a replacement VC. */
export async function issueCompanyIdentitySdJwt(
  agent: TraceChainAgent,
  input: {
    issuerDid: string;
    holderDid?: string;
    holderWallet?: string;
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
  if (
    input.holderWallet &&
    getAddress(input.holderWallet) !== getAddress(String(input.claims.walletAddress))
  )
    throw new Error('Issuer holder wallet differs from verified company wallet.');
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
      vct: input.holderWallet ? COMPANY_IDENTITY_SD_VCT_V3 : COMPANY_IDENTITY_SD_VCT_V2,
      policyVersion: 2,
      cnf: input.holderWallet
        ? { wallet: getAddress(input.holderWallet), proof: WALLET_HOLDER_BINDING }
        : { jwk: await holderPublicJwk(input.holderDid!) },
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

/** Issuer-only verification of a stored generic wallet attestation, never a holder proof. */
export async function verifyIssuedCompanyWalletAttestation(
  agent: TraceChainAgent,
  credential: string,
  now: number,
) {
  return verifierInstance(agent).verify(credential, {
    allowedIssuerAlgorithms: ['ES256K'],
    expectedVct: COMPANY_IDENTITY_SD_VCT_V3,
    currentDate: now,
    requiredClaimKeys: [
      'iss',
      'cnf',
      'sourceCredentialHash',
      'sourceCredentialId',
      'sourceCredentialIssuedAt',
      'sourceCredentialExpiresAt',
      ...COMPANY_ALWAYS_CLAIMS,
    ],
  });
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
    walletDomain?: { chainId: number; verifyingContract: string };
    wallet?: string;
    batchId?: string;
    expiresAt?: number;
  },
) {
  if (input.expiresAt !== undefined && input.now > input.expiresAt)
    throw new Error('The company presentation request has expired.');
  const wallet = parseWalletPresentation(presentation);
  const result = await verifierInstance(agent).verify(presentationSdJwt(presentation), {
    allowedIssuerAlgorithms: ['ES256K'],
    ...(!wallet
      ? {
          allowedKeyBindingAlgorithms: ['EdDSA'],
          expectedKeyBindingAudience: input.audience,
          keyBindingNonce: input.challenge,
          // Bound by the request deadline (and its single-use challenge), not a fixed 5 minutes.
          ...(input.expiresAt === undefined ? { keyBindingMaxAgeSeconds: 300 } : {}),
        }
      : {}),
    expectedVct: [COMPANY_IDENTITY_SD_VCT, COMPANY_IDENTITY_SD_VCT_V2, COMPANY_IDENTITY_SD_VCT_V3],
    currentDate: input.now,
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
  if ([COMPANY_IDENTITY_SD_VCT_V2, COMPANY_IDENTITY_SD_VCT_V3].includes(String(p.vct))) {
    for (const key of [...COMPANY_ALWAYS_CLAIMS, ...companyDisclosureGroup(input.requiredClaims)])
      if (!p[key])
        throw new Error(
          `Required signed company claim is unavailable: ${key}. Authorized replacement may be needed.`,
        );
    if ('companyRegistrationNumber' in p !== 'registrationCountry' in p)
      throw new Error('Registration number and country must be disclosed together.');
  }
  if (wallet) {
    const binding = p.cnf as { wallet?: string; proof?: string };
    if (
      p.vct !== COMPANY_IDENTITY_SD_VCT_V3 ||
      binding.proof !== WALLET_HOLDER_BINDING ||
      !binding.wallet ||
      !input.wallet ||
      !input.walletDomain ||
      getAddress(binding.wallet) !== getAddress(input.wallet) ||
      getAddress(String(p.walletAddress)) !== getAddress(input.wallet)
    )
      throw new Error('The issuer did not authorize this wallet binding.');
    verifyWalletPresentation(wallet, {
      ...input.walletDomain,
      holder: input.wallet,
      verifier: input.audience,
      requestId: input.requestId,
      purpose: input.purpose,
      challenge: input.challenge,
      batchId: input.batchId ?? ZeroHash,
      now: input.now,
      expiresAt: Math.min(input.expiresAt ?? Number(p.exp), Number(p.exp)),
    });
    return result;
  }
  if (p.vct === COMPANY_IDENTITY_SD_VCT_V3) throw new Error('A wallet holder proof is required.');
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
